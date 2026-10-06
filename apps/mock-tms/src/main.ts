#!/usr/bin/env node
/** Run the mock TMS: MOCK_TMS_PORT (4005), MOCK_TMS_TOKEN (bearer token). */

import { buildMockTms } from "./server.js";

const env = process.env;
const { app } = buildMockTms({ ...(env.MOCK_TMS_TOKEN ? { token: env.MOCK_TMS_TOKEN } : {}) });
const port = Number(env.MOCK_TMS_PORT ?? 4005);
const host = env.MOCK_TMS_HOST ?? "127.0.0.1";
await app.listen({ port, host });
console.log(JSON.stringify({ event: "listening", url: `http://${host}:${port}/v1/` }));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
