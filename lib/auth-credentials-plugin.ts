import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { authorizeCredentials } from "@/lib/services/credential-auth";
import { getAppConfig } from "@/lib/app-config";
import { isTwoFactorEnabled } from "@/lib/auth-2fa-session";

/**
 * Credential + guest sign-in that preserves existing authorizeCredentials /
 * disableGuestLogin behavior without storing env admin passwords in Account.
 */
export const vaehorCredentialsPlugin = (): BetterAuthPlugin => ({
  id: "vaehor-credentials",
  endpoints: {
    signInCredentials: createAuthEndpoint(
      "/vaehor/sign-in/credentials",
      { method: "POST" },
      // ponytail: Better Auth AuthEndpoint generics are awkward; ctx is framework-typed at runtime
      async (ctx: any) => {
        const body = (ctx.body ?? {}) as {
          email?: string;
          password?: string;
        };
        const user = await authorizeCredentials(
          { email: body.email, password: body.password },
          { headers: ctx.headers },
        );
        if (!user?.email) {
          throw new APIError("UNAUTHORIZED", {
            message: "Invalid credentials",
          });
        }

        const existing = await ctx.context.internalAdapter.findUserByEmail(
          user.email,
        );
        let userId = existing?.user.id;
        if (!userId) {
          const created = await ctx.context.internalAdapter.createUser({
            email: user.email,
            name: user.name ?? user.email.split("@")[0],
            emailVerified: true,
            role: user.role ?? "ADMIN",
          });
          userId = created.id;
        } else if (user.role) {
          await ctx.context.adapter.update({
            model: "user",
            where: [{ field: "id", value: userId }],
            update: { role: user.role },
          });
        }

        const twoFactorRequired = await isTwoFactorEnabled(user.email);
        // 4th arg overrideAll: defaults are applied after override and would
        // clobber isGuest/twoFactorRequired otherwise.
        const session = await ctx.context.internalAdapter.createSession(
          userId!,
          false,
          {
            isGuest: false,
            twoFactorRequired,
          },
          true,
        );
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Could not create session",
          });
        }

        const fullUser =
          (await ctx.context.internalAdapter.findUserById(userId!)) ??
          ({
            id: userId!,
            email: user.email,
            name: user.name,
            role: user.role,
          } as never);

        await setSessionCookie(ctx, { session, user: fullUser });
        return ctx.json({
          token: session.token,
          user: fullUser,
        });
      },
    ),
    signInGuest: createAuthEndpoint(
      "/vaehor/sign-in/guest",
      { method: "POST" },
      async (ctx: any) => {
        const config = await getAppConfig();
        if (config.disableGuestLogin) {
          throw new APIError("FORBIDDEN", {
            message: "Guest login disabled",
          });
        }

        const email = `guest-${crypto.randomUUID()}@guest.local`;
        const newUser = await ctx.context.internalAdapter.createUser({
          email,
          name: "Guest",
          emailVerified: false,
          role: "GUEST",
        });
        if (!newUser) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create guest",
          });
        }

        const session = await ctx.context.internalAdapter.createSession(
          newUser.id,
          false,
          { isGuest: true, twoFactorRequired: false },
          true,
        );
        if (!session) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Could not create session",
          });
        }

        await setSessionCookie(ctx, { session, user: newUser });
        return ctx.json({ token: session.token, user: newUser });
      },
    ),
  },
});
