import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

type PublicShimMap = Record<string, { shim: string }>;

/**
 * Vitest does not load `vinext()` (too heavy for unit tests). Mirror its
 * next/* → vinext/shims/* resolution from vinext's own public-shim-map.
 */
async function vinextNextShimsPlugin(): Promise<Plugin> {
  const serverShimUrl = import.meta.resolve("vinext/shims/server");
  const mapUrl = new URL("./public-shim-map.json.js", serverShimUrl);
  const { default: shimMap } = (await import(mapUrl.href)) as {
    default: PublicShimMap;
  };

  const resolved = new Map<string, string>();
  for (const [id, { shim }] of Object.entries(shimMap)) {
    resolved.set(
      id,
      fileURLToPath(import.meta.resolve(`vinext/shims/${shim}`)),
    );
  }

  return {
    name: "vinext-next-shims-for-vitest",
    enforce: "pre",
    resolveId(id) {
      return resolved.get(id) ?? null;
    },
  };
}

export default defineConfig({
  plugins: [react(), await vinextNextShimsPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./test/setup.ts",
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "@vaehor/sdk": path.resolve(
        import.meta.dirname,
        "./packages/sdk/src/index.ts",
      ),
      "@vaehor/mobile-bridge-protocol": path.resolve(
        import.meta.dirname,
        "./lib/mobile-bridge-protocol.ts",
      ),
    },
    exclude: [
      "node_modules",
      ".next/**",
      "e2e/**",
      "apps/mobile/node_modules/**",
      "apps/mobile/__tests__/app-shell.test.tsx",
      "apps/mobile/__tests__/container-preview.test.tsx",
      "packages/mcp/node_modules/**",
      "packages/sdk/node_modules/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["lib/**/*.ts", "hooks/**/*.ts", "components/**/*.tsx"],
      exclude: [
        "lib/db.ts",
        "lib/env.ts",
        "lib/kv.ts",
        "lib/store.ts",
        "lib/logger.ts",
        "lib/drive/index.ts",
        "**/*.d.ts",
        "**/*.test.*",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
