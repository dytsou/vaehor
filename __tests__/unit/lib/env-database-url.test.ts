import { describe, it, expect } from "vitest";
import { applyDatabaseUrlFromPostgres } from "@/lib/env";

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

  it("builds localhost URL from POSTGRES_* when DATABASE_URL is missing", () => {
    const env: NodeJS.ProcessEnv = {
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "s3cret@x",
      POSTGRES_DB: "vaehor",
    };
    expect(applyDatabaseUrlFromPostgres(env)).toBe(
      "postgresql://postgres:s3cret%40x@localhost:5432/vaehor?schema=public",
    );
    expect(env.DATABASE_URL).toContain("localhost:5432");
  });

  it("returns undefined when POSTGRES_* is incomplete", () => {
    expect(
      applyDatabaseUrlFromPostgres({ POSTGRES_USER: "postgres" }),
    ).toBeUndefined();
  });
});
