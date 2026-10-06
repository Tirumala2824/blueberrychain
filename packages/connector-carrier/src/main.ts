#!/usr/bin/env node
/**
 * Poll the TMS and land changes in RAW. Configuration (see .env.example):
 *   BBC_TMS_URL           default http://127.0.0.1:4005 (the mock)
 *   BBC_TMS_TOKEN         bearer token (mock default mock-tms-token)
 *   BBC_TMS_CONNECTOR_ID  default carrier-tms
 *   BBC_TMS_POLL_MS       default 5000
 *   BBC_TMS_SINK          snowflake (default; BBC_INGEST_SVC) or memory
 *   BBC_PROVENANCE        LIVE (default) | SIMULATION_LIVE | SIMULATION_BACKFILL
 *   --once                one sync pass, then exit
 */

import { MemorySink, type Provenance, type Sink, SnowflakeSink, syncSource } from "@blueberrychain/connector-sdk";
import { CarrierSource } from "./source.js";
import { TmsClient } from "./tms.js";

const env = process.env;
const connectorId = env.BBC_TMS_CONNECTOR_ID ?? "carrier-tms";
const sink: Sink = env.BBC_TMS_SINK === "memory" ? new MemorySink(connectorId) : SnowflakeSink.fromEnv(connectorId);
const source = new CarrierSource(
  new TmsClient({ baseUrl: env.BBC_TMS_URL ?? "http://127.0.0.1:4005", token: env.BBC_TMS_TOKEN ?? "mock-tms-token" }),
  {
    connectorId,
    ...(env.BBC_PROVENANCE ? { provenance: env.BBC_PROVENANCE as Provenance } : {}),
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
    if (reports.some((r) => r.rows > 0) || once) log({ event: "sync", streams: reports });
  } catch (error) {
    log({ event: "sync_failed", error: (error as Error).message });
    if (once) process.exit(1);
  }
  if (!once && !stopping) await new Promise((resolve) => setTimeout(resolve, Number(env.BBC_TMS_POLL_MS ?? 5000)));
} while (!once && !stopping);
