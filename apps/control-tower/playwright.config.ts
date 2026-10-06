import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
export const CANARY_PAT = "pat-canary-must-never-reach-a-browser-7f3a";

/**
 * UI end-to-end tests in fixture mode: the built app replays the recorded tapes, so
 * nothing needs Snowflake. One worker, because every test moves the shared tapes.
 * `corepack pnpm -r build` (or `next build`) must run first.
 */
export default defineConfig({
  testDir: "e2e",
  testIgnore: ["**/*.live.spec.ts"],
  workers: 1,
  fullyParallel: false,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BBC_API_MODE: "fixture",
      BBC_FIXTURE_TAPES: "S-A,S-B,S-C",
      BBC_CT_SESSION_SECRET: "e2e-session-secret",
      BBC_CT_ALLOWED_ORIGINS: `http://127.0.0.1:${PORT}`,
      BBC_CT_POLL_MS: "500",
      // A credential-shaped value that must never appear in anything the browser receives.
      BBC_SALES_PAT: CANARY_PAT,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
