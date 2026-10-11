import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts: Record<string, string>; dependencies: Record<string, string> };

describe("sole vinext scripts", () => {
  it("defaults dev/build/start to Vite/vinext", () => {
    expect(packageJson.scripts.dev).toContain("vite dev");
    expect(packageJson.scripts.build).toBe("vite build");
    expect(packageJson.scripts.start).toContain("vinext start");
  });

  it("has no Next CLI fallback scripts", () => {
    expect(packageJson.scripts["dev:next"]).toBeUndefined();
    expect(packageJson.scripts["dev:webpack"]).toBeUndefined();
    expect(packageJson.scripts["build:next"]).toBeUndefined();
    expect(packageJson.scripts["start:next"]).toBeUndefined();
    expect(packageJson.scripts.analyze).toBeUndefined();
  });

  it("keeps vinext as the app runtime", () => {
    expect(packageJson.dependencies.vinext).toBeTruthy();
  });

  // vinext standalone copies externals via createRequire(root/package.json);
  // pnpm does not hoist vinext's nested ipaddr.js, so it must be a direct dep.
  it("exposes ipaddr.js at the project root for vinext standalone", () => {
    expect(packageJson.dependencies["ipaddr.js"]).toBeTruthy();
    const rootRequire = createRequire(resolve(root, "package.json"));
    expect(() => rootRequire.resolve("ipaddr.js")).not.toThrow();
  });
});
