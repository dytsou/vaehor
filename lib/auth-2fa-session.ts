import { kv } from "@/lib/kv";
import { db } from "@/lib/db";

export function twoFactorEnabledKey(email: string): string {
  return `2fa:enabled:${email}`;
}

export async function isTwoFactorEnabled(email: string): Promise<boolean> {
  return !!(await kv.get(twoFactorEnabledKey(email)));
}

/** Clears the Better Auth session flag after a successful TOTP challenge. */
export async function clearSessionTwoFactorRequired(
  sessionToken: string,
): Promise<void> {
  await db.session.update({
    where: { token: sessionToken },
    data: { twoFactorRequired: false },
  });
}
