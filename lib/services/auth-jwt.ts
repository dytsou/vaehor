import type { Account, Profile, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { kv } from "@/lib/kv";
import { REDIS_KEYS } from "@/lib/constants";
import { normalizeAdminEmails } from "@/lib/services/credential-auth";

type AppRole = "ADMIN" | "EDITOR" | "USER";

export async function resolveRole(email: string): Promise<AppRole> {
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

async function syncDbUserRole(
  normalizedEmail: string,
  targetRole: AppRole,
  dbUser?: { role: string } | null,
) {
  const currentUser =
    dbUser ??
    (await db.user.findUnique({
      where: { email: normalizedEmail },
    }));

  if (currentUser && currentUser.role !== targetRole) {
    await db.user.update({
      where: { email: normalizedEmail },
      data: { role: targetRole },
    });
  }
}

async function resolveAndSyncRole(
  email: string,
  dbUser?: { role: string } | null,
): Promise<AppRole> {
  const normalizedEmail = email.toLowerCase().trim();
  const targetRole = await resolveRole(normalizedEmail);
  await syncDbUserRole(normalizedEmail, targetRole, dbUser);
  return targetRole;
}

function applyGuestJwtToken(token: JWT): JWT {
  token.id = "guest";
  token.name = "Guest";
  token.email = null;
  token.role = "GUEST";
  token.isGuest = true;
  token.twoFactorRequired = false;
  return token;
}

async function applyUserJwtClaims(token: JWT, user: User) {
  token.id = user.id;
  token.name = user.name;
  token.email = user.email;

  try {
    token.role = await resolveAndSyncRole(user.email!);
  } catch (err) {
    logger.error(
      { err, email: user.email },
      "[Auth] Error in JWT callback resolving role",
    );
  }

  token.twoFactorRequired = false;
}

async function ensureDbUser(normalizedEmail: string, name?: string | null) {
  let dbUser = await db.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!dbUser) {
    dbUser = await db.user.create({
      data: {
        email: normalizedEmail,
        name: name || normalizedEmail.split("@")[0],
        role: "USER",
      },
    });
  }

  return dbUser;
}

async function applyProfileJwtClaims(token: JWT, profile: Profile) {
  token.email = profile.email;

  const normalizedProfileEmail = profile.email!.toLowerCase().trim();
  try {
    const dbUser = await ensureDbUser(normalizedProfileEmail, profile.name);
    token.role = await resolveAndSyncRole(normalizedProfileEmail, dbUser);
  } catch (err) {
    logger.error(
      { err, email: normalizedProfileEmail },
      "[Auth] Error in JWT callback for profile",
    );
  }

  token.twoFactorRequired = false;
}

function finalizeJwtToken(token: JWT): JWT {
  if (typeof token.role === "string") {
    token.isGuest = token.role === "GUEST";
  }
  return token;
}

export async function handleJwtCallback({
  token,
  profile,
  user,
  account,
}: {
  token: JWT;
  profile?: Profile;
  user?: User;
  account?: Account | null;
}): Promise<JWT> {
  logger.debug(
    { hasUser: !!user, hasProfile: !!profile, email: token.email },
    "[Auth] JWT Callback Start",
  );

  if (account?.provider === "guest") {
    return applyGuestJwtToken(token);
  }

  if (user?.email) {
    await applyUserJwtClaims(token, user);
  } else if (profile?.email && !token.email) {
    await applyProfileJwtClaims(token, profile);
  }

  return finalizeJwtToken(token);
}
