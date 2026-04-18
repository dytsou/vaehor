import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authLimiter } from "@/lib/ratelimit";
import { kv } from "@/lib/kv";
import { REDIS_KEYS } from "@/lib/constants";
import bcrypt from "bcryptjs";
import type { ActivityDetails } from "@/lib/activityLogger";

import type { NextAuthConfig } from "next-auth";

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const encodedA = encoder.encode(a);
  const encodedB = encoder.encode(b);

  if (encodedA.length !== encodedB.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < encodedA.length; i += 1) {
    result |= encodedA[i] ^ encodedB[i];
  }

  return result === 0;
}

function normalizeAdminEmails(): string[] {
  const envAdminsRaw = process.env.ADMIN_EMAILS || "";
  return envAdminsRaw.split(",").map((e) =>
    e
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/g, ""),
  );
}

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

type AuthAuditType = "LOGIN_SUCCESS" | "LOGIN_FAILURE" | "RATE_LIMITED";

function emitAuthActivity<T extends AuthAuditType>(
  type: T,
  details: ActivityDetails<T>,
): void {
  void import("@/lib/activityLogger")
    .then(({ logActivity }) => logActivity(type, details))
    .catch((error) => {
      logger.error({ err: error, type }, "[Auth] Failed to record auth event");
    });
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
      async authorize(credentials, req) {
        const forwardedFor = req?.headers?.get?.("x-forwarded-for");
        const ip = forwardedFor
          ? forwardedFor.split(",")[0].trim()
          : "127.0.0.1";

        const ratelimitResult = await authLimiter.check(ip);
        if (!ratelimitResult.success) {
          emitAuthActivity("RATE_LIMITED", {
            userEmail:
              typeof credentials?.email === "string"
                ? credentials.email.toLowerCase().trim()
                : undefined,
            status: "blocked",
            metadata: {
              scope: "auth",
              identifier: ip,
            },
          });
          logger.warn({ ip }, "[Auth] Rate limit exceeded");
          throw new Error(
            "Terlalu banyak percobaan login. Silakan tunggu sebentar.",
          );
        }

        const email = credentials?.email as string;
        const password = credentials?.password as string;

        if (!email || !password) {
          emitAuthActivity("LOGIN_FAILURE", {
            userEmail:
              typeof email === "string"
                ? email.toLowerCase().trim()
                : undefined,
            status: "failure",
            metadata: {
              reason: "missing_credentials",
            },
          });
          logger.warn("[Auth] No credentials provided");
          return null;
        }

        try {
          const normalizedInputEmail = email.toLowerCase().trim();
          const dbUser = await db.user.findUnique({
            where: { email: normalizedInputEmail },
          });

          const normalizedEnvAdmins = normalizeAdminEmails();

          const isAdminEnv = normalizedEnvAdmins.includes(normalizedInputEmail);
          const isAdminDb = dbUser?.role === "ADMIN";
          const [adminCount, isRedisAdmin] = await Promise.all([
            kv.scard(REDIS_KEYS.ADMIN_USERS),
            kv.sismember(REDIS_KEYS.ADMIN_USERS, normalizedInputEmail),
          ]);

          // Same bootstrap behavior as resolveRole(): first admin can be seeded
          // from ADMIN_EMAILS, then all ongoing management uses admin API.
          let isAdmin = isAdminDb || isRedisAdmin === 1;
          if (adminCount === 0 && isAdminEnv) {
            try {
              await kv.sadd(REDIS_KEYS.ADMIN_USERS, ...normalizedEnvAdmins);
              isAdmin = true;
              logger.warn(
                { count: normalizedEnvAdmins.length },
                "[Auth] Seeded ADMIN_USERS from ADMIN_EMAILS (bootstrap)",
              );
            } catch (err) {
              logger.error(
                { err },
                "[Auth] Failed to seed ADMIN_USERS from env",
              );
            }
          }

          const envPassHash = process.env.ADMIN_PASSWORD_HASH || "";
          const envPass = (process.env.ADMIN_PASSWORD || "")
            .trim()
            .replace(/^["']|["']$/g, "");
          const isProduction = process.env.NODE_ENV === "production";

          let isPassValid = false;
          if (isProduction && !envPassHash) {
            logger.error(
              { email: normalizedInputEmail },
              "[Auth] ADMIN_PASSWORD_HASH is required in production for credential login",
            );
            return null;
          }

          if (envPassHash) {
            isPassValid = await bcrypt.compare(password, envPassHash);
          } else if (!isProduction && envPass) {
            isPassValid = constantTimeEqual(password, envPass);
          }

          if (process.env.NODE_ENV === "production") {
            logger.info(
              { inputEmail: normalizedInputEmail },
              "[Auth] Login attempt",
            );
          } else {
            logger.info(
              {
                inputEmail: normalizedInputEmail,
                isAdminDb,
                isAdminEnv,
                isAdmin,
                isPassValid,
              },
              "[Auth] Login attempt",
            );
          }

          if (isAdmin && isPassValid) {
            emitAuthActivity("LOGIN_SUCCESS", {
              userEmail: normalizedInputEmail,
              userRole: "ADMIN",
              status: "success",
            });
            logger.info(
              { email: normalizedInputEmail },
              "[Auth] Success: Credentials match",
            );

            let currentUser = dbUser;
            if (!currentUser) {
              logger.info(
                { email: normalizedInputEmail },
                "[Auth] Creating missing admin user in DB",
              );
              currentUser = await db.user.create({
                data: {
                  email: normalizedInputEmail,
                  role: "ADMIN",
                  name: normalizedInputEmail.split("@")[0],
                },
              });
            }

            return {
              id: currentUser.id,
              name: currentUser.name || normalizedInputEmail.split("@")[0],
              email: normalizedInputEmail,
              role: "ADMIN",
            };
          }

          logger.warn(
            { isAdmin, isPassValid, email: normalizedInputEmail },
            "[Auth] Failed: Invalid creds or not admin",
          );
          emitAuthActivity("LOGIN_FAILURE", {
            userEmail: normalizedInputEmail,
            status: "failure",
            metadata: {
              reason: isAdmin
                ? "invalid_password"
                : "not_admin_or_invalid_credentials",
            },
          });
          return null;
        } catch (error) {
          emitAuthActivity("LOGIN_FAILURE", {
            userEmail: email ? email.toLowerCase().trim() : undefined,
            status: "failure",
            error: error instanceof Error ? error.message : "auth_exception",
            metadata: {
              reason: "auth_exception",
            },
          });
          logger.error({ err: error }, "[Auth] Exception in authorize");
          return null;
        }
      },
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
