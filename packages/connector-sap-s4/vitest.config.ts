import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Tests run against the workspace sources (and a real mock S/4 on a random port).
export default defineConfig({
  resolve: {
    alias: {
      "@blueberrychain/shared": src("../shared/src/index.ts"),
      "@blueberrychain/connector-sdk": src("../connector-sdk/src/index.ts"),
      "@blueberrychain/mock-s4": src("../../apps/mock-s4/src/index.ts"),
    },
  },
});
