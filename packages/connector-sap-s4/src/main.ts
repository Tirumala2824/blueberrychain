#!/usr/bin/env node
/**
 * Poll S/4 and land changes in RAW. Configuration (see .env.example):
 *   BBC_SAP_URL           default http://127.0.0.1:4004/sap/opu/odata/sap (the mock)
 *   BBC_SAP_USER / BBC_SAP_PASSWORD   Basic auth (mock defaults BBC_CONNECTOR / mock)
 *   BBC_SAP_KEY_MAP       default .artifacts/sim/reference/sap_key_map.json (`bbc sim init`)
 *   BBC_SAP_CONNECTOR_ID  default sap-s4
 *   BBC_SAP_POLL_MS       default 5000; BBC_SAP_STOCK_EVERY_MIN (server minutes) default 15
 *   BBC_SAP_SINK          snowflake (default; BBC_INGEST_SVC) or memory
 *   BBC_PROVENANCE        LIVE (default) | SIMULATION_LIVE | SIMULATION_BACKFILL
 *   --once                one sync pass, then exit
 */

import { MemorySink, type Provenance, type Sink, SnowflakeSink, syncSource } from "@blueberrychain/connector-sdk";
import { loadKeyMap } from "./keymap.js";
import { ODataClient } from "./odata.js";
import { SapS4Source } from "./source.js";

const env = process.env;
const connectorId = env.BBC_SAP_CONNECTOR_ID ?? "sap-s4";
const sink: Sink = env.BBC_SAP_SINK === "memory" ? new MemorySink(connectorId) : SnowflakeSink.fromEnv(connectorId);
const client = new ODataClient({
  baseUrl: env.BBC_SAP_URL ?? "http://127.0.0.1:4004/sap/opu/odata/sap",
  user: env.BBC_SAP_USER ?? "BBC_CONNECTOR",
  password: env.BBC_SAP_PASSWORD ?? "mock",
});
const source = new SapS4Source(
  client,
  {
    connectorId,
    keys: loadKeyMap(env.BBC_SAP_KEY_MAP ?? "../../.artifacts/sim/reference/sap_key_map.json"),
    ...(env.BBC_PROVENANCE ? { provenance: env.BBC_PROVENANCE as Provenance } : {}),
  },
  {
    stockEveryMs: Number(env.BBC_SAP_STOCK_EVERY_MIN ?? 15) * 60_000,
    onSkip: (stream, reason) => console.log(JSON.stringify({ event: "skipped", stream, reason })),
  },
);

const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
const once = process.argv.includes("--once");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true));

do {
  try {
    const reports = await syncSource(source, sink);
    const moved = reports.filter((r) => r.rows > 0);
    if (moved.length || once) log({ event: "sync", streams: reports });
  } catch (error) {
    log({ event: "sync_failed", error: (error as Error).message });
    if (once) process.exit(1);
  }
  if (!once && !stopping) await new Promise((resolve) => setTimeout(resolve, Number(env.BBC_SAP_POLL_MS ?? 5000)));
} while (!once && !stopping);
