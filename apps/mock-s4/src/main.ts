#!/usr/bin/env node
/** Run the mock S/4: MOCK_S4_PORT (4004), MOCK_S4_USER / MOCK_S4_PASSWORD (Basic auth). */

import { buildMockS4 } from "./server.js";

const env = process.env;
const { app } = buildMockS4({
  ...(env.MOCK_S4_USER ? { user: env.MOCK_S4_USER } : {}),
  ...(env.MOCK_S4_PASSWORD ? { password: env.MOCK_S4_PASSWORD } : {}),
});
const port = Number(env.MOCK_S4_PORT ?? 4004);
const host = env.MOCK_S4_HOST ?? "127.0.0.1";
await app.listen({ port, host });
console.log(JSON.stringify({ event: "listening", url: `http://${host}:${port}/sap/opu/odata/sap/` }));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
