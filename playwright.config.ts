import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,

  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: "html",

  use: {
    baseURL: "http://localhost:3000",

    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  webServer: {
    // ponytail: pnpm 11.27+ runs scripts in their own process group. Playwright's
    // default SIGKILL only kills pnpm and orphans vite, so CI hangs until the
    // step timeout. SIGTERM lets pnpm relay and close the pipes. Ceiling: if a
    // future pnpm still orphans on SIGKILL escalation, point command at vite
    // directly (or upgrade pnpm once its process-group watchdog lands).
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
