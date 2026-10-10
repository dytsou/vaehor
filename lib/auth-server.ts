import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
import { db } from "@/lib/db";
import { vaehorCredentialsPlugin } from "@/lib/auth-credentials-plugin";
import { isTwoFactorEnabled } from "@/lib/auth-2fa-session";
import { resolveAndSyncRole } from "@/lib/services/auth-jwt";
import { logger } from "@/lib/logger";

/**
 * Better Auth server (vinext sole-default). Credential/guest via plugin;
 * Google via socialProviders; mobile via bearer plugin.
 */
export const authServer = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXTAUTH_URL,
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "USER",
        required: false,
        input: false,
      },
    },
  },
  session: {
    additionalFields: {
      twoFactorRequired: {
        type: "boolean",
        defaultValue: false,
        required: false,
        input: false,
      },
      isGuest: {
        type: "boolean",
        defaultValue: false,
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        async before(session) {
          try {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { email: true, role: true },
            });
            if (!user?.email) return;

            const isGuest =
              user.role === "GUEST" ||
              !!(session as { isGuest?: boolean }).isGuest;
            if (!isGuest) {
              await resolveAndSyncRole(user.email, user);
            }

            const twoFactorRequired = isGuest
              ? false
              : await isTwoFactorEnabled(user.email);
            return {
              data: {
                ...session,
                twoFactorRequired:
                  (session as { twoFactorRequired?: boolean })
                    .twoFactorRequired ?? twoFactorRequired,
              },
            };
          } catch (err) {
            logger.error({ err }, "[Auth] session.create role/2FA hook failed");
          }
        },
      },
    },
  },
  plugins: [bearer(), vaehorCredentialsPlugin()],
});

export type AuthSession = typeof authServer.$Infer.Session;
