import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Unit tests cover the framework-free server, console and domain modules (src/**/*.test.ts).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src("./src/")}` },
      { find: /^@blueberrychain\/shared\/cockpit$/, replacement: src("../../packages/shared/src/cockpit.ts") },
      { find: /^@blueberrychain\/shared$/, replacement: src("../../packages/shared/src/index.ts") },
      { find: /^@blueberrychain\/bbc-api$/, replacement: src("../../packages/bbc-api/src/index.ts") },
    ],
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
