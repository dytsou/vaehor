import { db } from "@/lib/db";
import { kv } from "@/lib/kv";
import { REDIS_KEYS } from "@/lib/constants";
import {
  normalizeAdminEmails,
  syncAdminsFromEnv,
} from "@/lib/services/credential-auth";

type AppRole = "ADMIN" | "EDITOR" | "USER";

export async function resolveRole(email: string): Promise<AppRole> {
  const normalizedEmail = email.toLowerCase().trim();
  await syncAdminsFromEnv();
  const normalizedEnvAdmins = normalizeAdminEmails();

  const dbUser = await db.user.findUnique({
    where: { email: normalizedEmail },
  });

  const [isRedisAdmin, isRedisEditor] = await Promise.all([
    kv.sismember(REDIS_KEYS.ADMIN_USERS, normalizedEmail),
    kv.sismember(REDIS_KEYS.ADMIN_EDITORS, normalizedEmail),
  ]);

  const isAdmin =
    dbUser?.role === "ADMIN" ||
    isRedisAdmin === 1 ||
    normalizedEnvAdmins.includes(normalizedEmail);
  const isEditor = dbUser?.role === "EDITOR" || isRedisEditor === 1;

  if (isAdmin) return "ADMIN";
  if (isEditor) return "EDITOR";
  return "USER";
}

export async function revokeEditorAccess(email: string) {
  const normalizedEmail = email.toLowerCase().trim();
  await db.user.updateMany({
    where: { email: normalizedEmail, role: "EDITOR" },
    data: { role: "USER" },
  });
  await kv.srem(REDIS_KEYS.ADMIN_EDITORS, normalizedEmail);
  return normalizedEmail;
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

/** Sync ADMIN_EMAILS / Redis / DB role onto the User row (Google + credential login). */
export async function resolveAndSyncRole(
  email: string,
  dbUser?: { role: string } | null,
): Promise<AppRole> {
  const normalizedEmail = email.toLowerCase().trim();
  const targetRole = await resolveRole(normalizedEmail);
  await syncDbUserRole(normalizedEmail, targetRole, dbUser);
  return targetRole;
}
