import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { kv } from "@/lib/kv";
import { REDIS_KEYS } from "@/lib/constants";
import type { NextAuthConfig } from "next-auth";
import {
  authorizeCredentials,
  normalizeAdminEmails,
} from "@/lib/services/credential-auth";

async function resolveRole(
  email: string,
): Promise<"ADMIN" | "EDITOR" | "USER"> {
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedEnvAdmins = normalizeAdminEmails();

  const dbUser = await db.user.findUnique({
    where: { email: normalizedEmail },
  });

  const [adminCountRaw, isRedisAdminRaw, isRedisEditor] = await Promise.all([
    kv.scard(REDIS_KEYS.ADMIN_USERS),
    kv.sismember(REDIS_KEYS.ADMIN_USERS, normalizedEmail),
    kv.sismember(REDIS_KEYS.ADMIN_EDITORS, normalizedEmail),
  ]);

  let adminCount = adminCountRaw;
  let isRedisAdmin = isRedisAdminRaw;

  // Bootstrap: if no admins exist yet, seed from ADMIN_EMAILS once.
  // After seeding, roles are managed via the admin API (Redis sets).
  if (adminCount === 0 && normalizedEnvAdmins.length > 0) {
    try {
      await kv.sadd(REDIS_KEYS.ADMIN_USERS, ...normalizedEnvAdmins);
      adminCount = normalizedEnvAdmins.length;
      isRedisAdmin = normalizedEnvAdmins.includes(normalizedEmail) ? 1 : 0;
      logger.warn(
        { count: normalizedEnvAdmins.length },
        "[Auth] Seeded ADMIN_USERS from ADMIN_EMAILS (bootstrap)",
      );
    } catch (err) {
      logger.error({ err }, "[Auth] Failed to seed ADMIN_USERS from env");
    }
  }

  const isAdmin = dbUser?.role === "ADMIN" || isRedisAdmin === 1;
  const isEditor = dbUser?.role === "EDITOR" || isRedisEditor === 1;

  if (isAdmin) return "ADMIN";
  if (isEditor) return "EDITOR";
  return "USER";
}

const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db as any),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
    Credentials({
      id: "guest",
      name: "Guest",
      credentials: {},
      async authorize() {
        const { getAppConfig } = await import("@/lib/app-config");
        const config = await getAppConfig();
        if (config.disableGuestLogin) {
          return null;
        }

        return {
          id: "guest",
          name: "Guest",
          email: undefined,
          role: "GUEST",
        };
      },
    }),
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, profile, user, account }) {
      logger.debug(
        { hasUser: !!user, hasProfile: !!profile, email: token.email },
        "[Auth] JWT Callback Start",
      );
      if (account?.provider === "guest") {
        token.id = "guest";
        token.name = "Guest";
        token.email = null;
        token.role = "GUEST";
        token.isGuest = true;
        token.twoFactorRequired = false;
        return token;
      }

      if (user && user.email) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;

        try {
          const targetRole = await resolveRole(user.email);
          token.role = targetRole;

          const normalizedUserEmail = user.email.toLowerCase().trim();
          const dbUser = await db.user.findUnique({
            where: { email: normalizedUserEmail },
          });

          if (dbUser && dbUser.role !== targetRole) {
            await db.user.update({
              where: { email: normalizedUserEmail },
              data: { role: targetRole },
            });
          }
        } catch (err) {
          logger.error(
            { err, email: user.email },
            "[Auth] Error in JWT callback resolving role",
          );
        }

        token.twoFactorRequired = false;
      } else if (profile?.email && !token.email) {
        token.email = profile.email;

        const normalizedProfileEmail = profile.email.toLowerCase().trim();
        try {
          let dbUser = await db.user.findUnique({
            where: { email: normalizedProfileEmail },
          });

          if (!dbUser) {
            dbUser = await db.user.create({
              data: {
                email: normalizedProfileEmail,
                name: profile.name || normalizedProfileEmail.split("@")[0],
                role: "USER",
              },
            });
          }

          const targetRole = await resolveRole(normalizedProfileEmail);
          token.role = targetRole;

          if (dbUser.role !== targetRole) {
            await db.user.update({
              where: { email: normalizedProfileEmail },
              data: { role: targetRole },
            });
          }
        } catch (err) {
          logger.error(
            { err, email: normalizedProfileEmail },
            "[Auth] Error in JWT callback for profile",
          );
        }

        token.twoFactorRequired = false;
      }
      if (typeof token.role === "string") {
        token.isGuest = token.role === "GUEST";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const role = (token.role as any) || "USER";
        session.user.role = role;
        session.user.email = token.email as string;
        session.user.isGuest =
          token.isGuest ?? (role ? role === "GUEST" : false);
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  cookies: {
    sessionToken: {
      name: `authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
