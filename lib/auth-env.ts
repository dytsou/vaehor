/** Better Auth secret / public origin (sole auth env names). */

export function getAuthSecret(): string | undefined {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  return secret || undefined;
}

export function getAuthUrl(): string | undefined {
  const url = process.env.BETTER_AUTH_URL?.trim();
  return url || undefined;
}
