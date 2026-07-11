import "dotenv/config";
import { defineConfig } from "prisma/config";
import { applyDatabaseUrlFromPostgres } from "./lib/env-url";

// Same POSTGRES_* → DATABASE_URL derivation as the Next app (lib/env.ts).
applyDatabaseUrlFromPostgres();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Keep `prisma generate` usable even when DATABASE_URL
    // isn't present in the current shell (e.g. CI or editor tooling).
    url: process.env.DATABASE_URL,
  },
});
