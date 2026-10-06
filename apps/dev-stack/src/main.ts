#!/usr/bin/env node
/**
 * The simulated world on one machine: mock S/4 (:4004), mock TMS (:4005), the IoT
 * webhook (:8787), and the SAP and carrier connectors polling them. Drive it with
 * `bbc sim run --scenario S-A --reset`.
 *
 *   BBC_STACK_SINK   memory (default: one shared in-memory RAW, inspect at :8790) or
 *                    snowflake (each connector lands in Snowflake as BBC_INGEST_SVC)
 *   BBC_STACK_POLL_MS  connector poll interval, default 1000
 *   BBC_IOT_HMAC_SECRET  required (shared with the simulator through .env)
 *
 * Inspection (memory sink): GET http://127.0.0.1:8790/state, /rows?entity=LOT
 */

import { createServer } from "node:http";
import { CarrierSource, TmsClient } from "@blueberrychain/connector-carrier";
import { createIotServer } from "@blueberrychain/connector-iot";
import { loadKeyMap, ODataClient, SapS4Source } from "@blueberrychain/connector-sap-s4";
import {
  BatchingWriter,
  type BusinessEventRow,
  FileDeadLetter,
  MemorySink,
  memoryRaw,
  type Provenance,
  type Sink,
  SnowflakeSink,
  syncSource,
} from "@blueberrychain/connector-sdk";
import { buildMockS4 } from "@blueberrychain/mock-s4";
import { buildMockTms } from "@blueberrychain/mock-tms";

const env = process.env;
const secret = env.BBC_IOT_HMAC_SECRET;
if (!secret) {
  console.error("BBC_IOT_HMAC_SECRET is not set (see .env.example)");
  process.exit(1);
}
const host = "127.0.0.1";
const provenance: Provenance = "SIMULATION_LIVE";
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

// One shared in-memory RAW: each connector checks rows exactly as API.INGEST_BATCH does.
const raw = memoryRaw();
const sinkFor = (connectorId: string): Sink =>
  env.BBC_STACK_SINK === "snowflake" ? SnowflakeSink.fromEnv(connectorId) : new MemorySink(connectorId, raw);

const s4 = buildMockS4();
const tms = buildMockTms();
await s4.app.listen({ port: 4004, host });
await tms.app.listen({ port: 4005, host });

const deadLetter = new FileDeadLetter(env.BBC_DEAD_LETTER_DIR ?? "../../.artifacts/dead-letter");
const iotSink = sinkFor("iot-webhook");
const iot = createIotServer({
  connectorId: "iot-webhook",
  secret,
  writer: new BatchingWriter(iotSink, "TELEMETRY", { maxRows: 500, maxDelayMs: 200, deadLetter }),
  eventWriter: new BatchingWriter(iotSink, "BUSINESS_EVENTS", { maxRows: 200, maxDelayMs: 200, deadLetter }),
  log: () => {},
});
await new Promise<void>((resolve) => iot.listen(8787, host, resolve));

const sap = new SapS4Source(
  new ODataClient({ baseUrl: `http://${host}:4004/sap/opu/odata/sap`, user: "BBC_CONNECTOR", password: "mock" }),
  { connectorId: "sap-s4", keys: loadKeyMap(env.BBC_SAP_KEY_MAP ?? "../../.artifacts/sim/reference/sap_key_map.json"), provenance },
  { stockEveryMs: 15 * 60_000, onSkip: (stream, reason) => log({ event: "skipped", stream, reason }) },
);
const carrier = new CarrierSource(new TmsClient({ baseUrl: `http://${host}:4005`, token: "mock-tms-token" }), {
  connectorId: "carrier-tms",
  provenance,
  onSkip: (stream, reason) => log({ event: "skipped", stream, reason }),
});
const pollers = [
  { source: sap, sink: sinkFor("sap-s4") },
  { source: carrier, sink: sinkFor("carrier-tms") },
];

let polling = false;
const timer = setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    for (const { source, sink } of pollers) {
      const reports = await syncSource(source, sink);
      const moved = reports.filter((r) => r.rows > 0);
      if (moved.length) log({ event: "sync", connector: sink.connectorId, streams: moved });
    }
  } catch (error) {
    log({ event: "sync_failed", error: (error as Error).message });
  } finally {
    polling = false;
  }
}, Number(env.BBC_STACK_POLL_MS ?? 1000));

const inspect = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}`);
  const send = (body: unknown) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body, null, 1));
  };
  const events = [...raw.tables.BUSINESS_EVENTS.values()] as BusinessEventRow[];
  if (url.pathname === "/state") {
    const byEntity: Record<string, number> = {};
    for (const e of events) byEntity[e.entity_type] = (byEntity[e.entity_type] ?? 0) + 1;
    const devices: Record<string, number> = {};
    for (const row of raw.tables.TELEMETRY.values()) {
      const device = (row as { device_id: string }).device_id;
      devices[device] = (devices[device] ?? 0) + 1;
    }
    return send({
      sink: env.BBC_STACK_SINK ?? "memory",
      telemetry: raw.tables.TELEMETRY.size,
      telemetry_by_device: devices,
      business_events: byEntity,
      dead_letters: raw.deadLetters.map((d) => ({ connector: d.connectorId, target: d.target, errors: d.errors })),
      skipped: [...sap.skipped, ...carrier.skipped],
      cursors: Object.fromEntries([...raw.cursors].map(([id, streams]) => [id, Object.fromEntries(streams)])),
    });
  }
  if (url.pathname === "/rows") return send(events.filter((e) => e.entity_type === url.searchParams.get("entity")));
  if (url.pathname === "/telemetry") return send([...raw.tables.TELEMETRY.values()]);
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => inspect.listen(8790, host, resolve));
log({ event: "listening", s4: `http://${host}:4004`, tms: `http://${host}:4005`, iot: `http://${host}:8787`, inspect: `http://${host}:8790/state`, sink: env.BBC_STACK_SINK ?? "memory" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void Promise.all([s4.app.close(), tms.app.close()]).then(() => process.exit(0));
  });
}
