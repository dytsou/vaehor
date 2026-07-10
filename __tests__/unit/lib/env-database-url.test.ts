import { describe, it, expect } from "vitest";
import { applyDatabaseUrlFromPostgres, applyLocalRedisUrl } from "@/lib/env";

describe("applyDatabaseUrlFromPostgres", () => {
  it("leaves an existing DATABASE_URL alone", () => {
    const env = {
      DATABASE_URL: "postgresql://a:b@db:5432/x?schema=public",
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "vaehor",
    };
    expect(applyDatabaseUrlFromPostgres(env)).toBe(
      "postgresql://a:b@db:5432/x?schema=public",
    );
  });

  it("builds 127.0.0.1:5433 URL from POSTGRES_* when DATABASE_URL is missing", () => {
    const env: NodeJS.ProcessEnv = {
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "s3cret@x",
      POSTGRES_DB: "vaehor",
    };
    expect(applyDatabaseUrlFromPostgres(env)).toBe(
      "postgresql://postgres:s3cret%40x@127.0.0.1:5433/vaehor?schema=public",
    );
    expect(env.DATABASE_URL).toContain("127.0.0.1:5433");
  });

  it("honors POSTGRES_PORT override", () => {
    const env: NodeJS.ProcessEnv = {
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "vaehor",
      POSTGRES_PORT: "5432",
    };
    expect(applyDatabaseUrlFromPostgres(env)).toContain(":5432/");
  });

  it("returns undefined when POSTGRES_* is incomplete", () => {
    expect(
      applyDatabaseUrlFromPostgres({ POSTGRES_USER: "postgres" }),
    ).toBeUndefined();
  });
});

describe("applyLocalRedisUrl", () => {
  it("leaves an existing REDIS_URL alone", () => {
    const env: NodeJS.ProcessEnv = { REDIS_URL: "redis://cache:6379" };
    expect(applyLocalRedisUrl(env)).toBe("redis://cache:6379");
  });

  it("defaults to local Redis outside production/CI", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "development" };
    expect(applyLocalRedisUrl(env)).toBe("redis://127.0.0.1:6379");
    expect(env.REDIS_URL).toBe("redis://127.0.0.1:6379");
  });

  it("does not invent REDIS_URL in production or CI", () => {
    expect(applyLocalRedisUrl({ NODE_ENV: "production" })).toBeUndefined();
    expect(applyLocalRedisUrl({ CI: "true" })).toBeUndefined();
  });
});
