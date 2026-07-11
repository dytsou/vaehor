import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const nextConfig = readFileSync(resolve(root, "next.config.mjs"), "utf8");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("Turbopack FS cache / ROFS hygiene", () => {
  it("opts into FS cache only when TURBOPACK_FS_CACHE=1", () => {
    expect(nextConfig).toContain("turbopackFileSystemCacheForDev");
    expect(nextConfig).toMatch(
      /turbopackFileSystemCacheForDev:\s*process\.env\.TURBOPACK_FS_CACHE\s*===\s*["']1["']/,
    );
  });

  it("exposes clean and webpack fallback scripts", () => {
    expect(packageJson.scripts.dev).toContain("--turbopack");
    expect(packageJson.scripts["dev:webpack"]).toContain("--webpack");
    expect(packageJson.scripts["dev:clean"]).toMatch(/rm -rf \.next/);
    expect(packageJson.scripts["dev:fresh"]).toContain("dev:clean");
  });
});
