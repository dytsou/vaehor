/** Shared env URL helpers — no side effects (safe for Prisma CLI). */

function stripEnvQuotes(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

/** When DATABASE_URL is unset, build it from POSTGRES_* (same as docker-compose). */
export function applyDatabaseUrlFromPostgres(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (stripEnvQuotes(env.DATABASE_URL)) return env.DATABASE_URL;
  const user = stripEnvQuotes(env.POSTGRES_USER);
  const password = stripEnvQuotes(env.POSTGRES_PASSWORD);
  const db = stripEnvQuotes(env.POSTGRES_DB);
  if (!user || !password || !db) return undefined;

  const host = stripEnvQuotes(env.POSTGRES_HOST) || "127.0.0.1";
  const port = stripEnvQuotes(env.POSTGRES_PORT) || "5432";
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}?schema=public`;
  env.DATABASE_URL = url;
  return url;
}

/** When REDIS_URL is unset outside production/CI, default to local compose Redis. */
export function applyLocalRedisUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (stripEnvQuotes(env.REDIS_URL)) return env.REDIS_URL;
  if (env.NODE_ENV === "production" || env.CI === "true") return undefined;
  const url = "redis://127.0.0.1:6379";
  env.REDIS_URL = url;
  return url;
}
