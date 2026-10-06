import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against the workspace sources, so they never depend on a stale build.
export default defineConfig({
  resolve: {
    alias: {
      "@blueberrychain/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
      "@blueberrychain/connector-sdk": fileURLToPath(new URL("../connector-sdk/src/index.ts", import.meta.url)),
    },
  },
});
