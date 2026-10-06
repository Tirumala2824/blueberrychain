import { defineConfig } from "@playwright/test";

/**
 * Live smoke tests against a running control tower in live mode (real Snowflake).
 * Opt-in: BBC_E2E_LIVE=1 BBC_E2E_BASE_URL=http://127.0.0.1:3000 corepack pnpm --filter @blueberrychain/control-tower e2e:live
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.live.spec.ts",
  workers: 1,
  use: { baseURL: process.env["BBC_E2E_BASE_URL"] ?? "http://127.0.0.1:3000", viewport: { width: 1440, height: 1000 } },
});
