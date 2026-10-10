import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** vinext owns next/* at runtime; vitest does not load the vinext plugin. */
const nextShimAliases = Object.fromEntries(
  (
    [
      ["next/server", "vinext/shims/server"],
      ["next/headers", "vinext/shims/headers"],
      ["next/navigation", "vinext/shims/navigation"],
      ["next/cache", "vinext/shims/cache"],
      ["next/og", "vinext/shims/og"],
      ["next/image", "vinext/shims/image"],
      ["next/link", "vinext/shims/link"],
      ["next/dynamic", "vinext/shims/dynamic"],
      ["next/font/google", "vinext/shims/font-google"],
    ] as const
  ).map(([id, shim]) => [id, fileURLToPath(import.meta.resolve(shim))]),
);

export default defineConfig({
  plugins: [react()],
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
      ...nextShimAliases,
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
