import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authLimiter } from "@/lib/ratelimit";
import { kv } from "@/lib/kv";
import { REDIS_KEYS } from "@/lib/constants";
import type { ActivityDetails } from "@/lib/activityLogger";

type AuthAuditType = "LOGIN_SUCCESS" | "LOGIN_FAILURE" | "RATE_LIMITED";

type CredentialAuthRequest = {
  headers?: {
    get?: (name: string) => string | null;
  };
};

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

export function normalizeAdminEmails(): string[] {
  const envAdminsRaw = process.env.ADMIN_EMAILS || "";
  return envAdminsRaw
    .split(",")
    .map((email) =>
      email
        .trim()
        .toLowerCase()
        .replace(/^["']|["']$/g, ""),
    )
    .filter(Boolean);
}

/**
 * Keep Redis ADMIN_USERS aligned with ADMIN_EMAILS across restarts/env edits.
 * - First sync: add env emails and record the snapshot (does not wipe API-added admins).
 * - Later env changes: add new env emails and remove emails that left ADMIN_EMAILS.
 * Admins added only via Admin API (never in the env snapshot) are left alone.
 */
export async function syncAdminsFromEnv(): Promise<{
  added: string[];
  removed: string[];
}> {
  const current = normalizeAdminEmails();
  const currentKey = JSON.stringify(
    [...current].sort((a, b) => a.localeCompare(b)),
  );

  let raw: string | null = null;
  try {
    raw = await kv.get<string>(REDIS_KEYS.ADMIN_USERS_ENV_SYNC);
  } catch (error) {
    logger.error(
      { err: error },
      "[Auth] Failed to read ADMIN_USERS env sync state",
    );
    return { added: [], removed: [] };
  }

  if (raw === currentKey) {
    return { added: [], removed: [] };
  }

  const isFirstSync = raw == null;
  let previous: string[] = [];
  if (!isFirstSync && raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        previous = parsed.filter((e): e is string => typeof e === "string");
      }
    } catch {
      previous = [];
    }
  }

  const prevSet = new Set(previous);
  const toAdd = isFirstSync
    ? current
    : current.filter((email) => !prevSet.has(email));
  const toRemove = isFirstSync
    ? []
    : previous.filter((email) => !current.includes(email));

  try {
    if (toAdd.length > 0) {
      await kv.sadd(REDIS_KEYS.ADMIN_USERS, ...toAdd);
    }
    if (toRemove.length > 0) {
      await kv.srem(REDIS_KEYS.ADMIN_USERS, ...toRemove);
    }
    await kv.set(REDIS_KEYS.ADMIN_USERS_ENV_SYNC, currentKey);
    logger.warn(
      { added: toAdd.length, removed: toRemove.length, initial: isFirstSync },
      "[Auth] Synced ADMIN_USERS from ADMIN_EMAILS",
    );
    return { added: toAdd, removed: toRemove };
  } catch (error) {
    logger.error({ err: error }, "[Auth] Failed to sync ADMIN_USERS from env");
    return { added: [], removed: [] };
  }
}

function emitAuthActivity<T extends AuthAuditType>(
  type: T,
  details: ActivityDetails<T>,
): void {
  import("@/lib/activityLogger")
    .then(({ logActivity }) => logActivity(type, details))
    .catch((error) => {
      logger.error({ err: error, type }, "[Auth] Failed to record auth event");
    });
}

function getAuthClientIp(req?: CredentialAuthRequest): string {
  const forwardedFor = req?.headers?.get?.("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
}

function getCredentialEmail(credentials?: Record<string, unknown>) {
  return typeof credentials?.email === "string"
    ? credentials.email.toLowerCase().trim()
    : undefined;
}

async function enforceAuthRateLimit(
  credentials: Record<string, unknown> | undefined,
  ip: string,
) {
  const ratelimitResult = await authLimiter.check(ip);
  if (ratelimitResult.success) {
    return;
  }

  emitAuthActivity("RATE_LIMITED", {
    userEmail: getCredentialEmail(credentials),
    status: "blocked",
    metadata: {
      scope: "auth",
      identifier: ip,
    },
  });
  logger.warn({ ip }, "[Auth] Rate limit exceeded");
  throw new Error("Terlalu banyak percobaan login. Silakan tunggu sebentar.");
}

async function resolveCredentialAdminStatus(
  normalizedInputEmail: string,
  dbUser: { role: string } | null,
): Promise<boolean> {
  await syncAdminsFromEnv();

  const normalizedEnvAdmins = normalizeAdminEmails();
  const isAdminEnv = normalizedEnvAdmins.includes(normalizedInputEmail);
  const isAdminDb = dbUser?.role === "ADMIN";
  const isRedisAdmin = await kv.sismember(
    REDIS_KEYS.ADMIN_USERS,
    normalizedInputEmail,
  );

  return isAdminDb || isRedisAdmin === 1 || isAdminEnv;
}

async function verifyAdminPassword(
  password: string,
  normalizedInputEmail: string,
): Promise<boolean | null> {
  const envPassHash = process.env.ADMIN_PASSWORD_HASH || "";
  const envPass = (process.env.ADMIN_PASSWORD || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !envPassHash) {
    logger.error(
      { email: normalizedInputEmail },
      "[Auth] ADMIN_PASSWORD_HASH is required in production for credential login",
    );
    return null;
  }

  if (envPassHash) {
    return bcrypt.compare(password, envPassHash);
  }

  if (!isProduction && envPass) {
    return constantTimeEqual(password, envPass);
  }

  return false;
}

function logCredentialLoginAttempt(
  normalizedInputEmail: string,
  debug: {
    isAdminDb: boolean;
    isAdminEnv: boolean;
    isAdmin: boolean;
    isPassValid: boolean;
  },
) {
  if (process.env.NODE_ENV === "production") {
    logger.info({ inputEmail: normalizedInputEmail }, "[Auth] Login attempt");
    return;
  }

  logger.info(
    {
      inputEmail: normalizedInputEmail,
      isAdminDb: debug.isAdminDb,
      isAdminEnv: debug.isAdminEnv,
      isAdmin: debug.isAdmin,
      isPassValid: debug.isPassValid,
    },
    "[Auth] Login attempt",
  );
}

async function createAdminSessionUser(
  normalizedInputEmail: string,
  dbUser: { id: string; name: string | null } | null,
) {
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
    role: "ADMIN" as const,
  };
}

function recordCredentialLoginFailure(
  normalizedInputEmail: string,
  isAdmin: boolean,
) {
  logger.warn(
    { isAdmin, email: normalizedInputEmail },
    "[Auth] Failed: Invalid creds or not admin",
  );
  emitAuthActivity("LOGIN_FAILURE", {
    userEmail: normalizedInputEmail,
    status: "failure",
    metadata: {
      reason: isAdmin ? "invalid_password" : "not_admin_or_invalid_credentials",
    },
  });
}

export async function authorizeCredentials(
  credentials: Record<string, unknown> | undefined,
  req?: CredentialAuthRequest,
) {
  const ip = getAuthClientIp(req);
  await enforceAuthRateLimit(credentials, ip);

  const email = credentials?.email as string | undefined;
  const password = credentials?.password as string | undefined;

  if (!email || !password) {
    emitAuthActivity("LOGIN_FAILURE", {
      userEmail:
        typeof email === "string" ? email.toLowerCase().trim() : undefined,
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
    const normalizedEnvAdmins = normalizeAdminEmails();
    const dbUser = await db.user.findUnique({
      where: { email: normalizedInputEmail },
    });
    const isAdmin = await resolveCredentialAdminStatus(
      normalizedInputEmail,
      dbUser,
    );
    const isPassValid = await verifyAdminPassword(
      password,
      normalizedInputEmail,
    );

    if (isPassValid === null) {
      return null;
    }

    logCredentialLoginAttempt(normalizedInputEmail, {
      isAdminDb: dbUser?.role === "ADMIN",
      isAdminEnv: normalizedEnvAdmins.includes(normalizedInputEmail),
      isAdmin,
      isPassValid,
    });

    if (isAdmin && isPassValid) {
      return await createAdminSessionUser(normalizedInputEmail, dbUser);
    }

    recordCredentialLoginFailure(normalizedInputEmail, isAdmin);
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
}
