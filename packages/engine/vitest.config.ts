import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Tests run against the workspace sources, fakes for Snowflake, and a real mock TMS.
export default defineConfig({
  resolve: {
    alias: {
      "@blueberrychain/shared": src("../shared/src/index.ts"),
      "@blueberrychain/bbc-api": src("../bbc-api/src/index.ts"),
      "@blueberrychain/connector-sdk": src("../connector-sdk/src/index.ts"),
      "@blueberrychain/connector-carrier": src("../connector-carrier/src/index.ts"),
      "@blueberrychain/connector-sap-s4": src("../connector-sap-s4/src/index.ts"),
      "@blueberrychain/mock-tms": src("../../apps/mock-tms/src/index.ts"),
    },
  },
});
