#!/usr/bin/env node
/**
 * bbc-engine: the lifecycle worker and the mutation dispatcher in one process.
 *
 *   bbc-engine [--worker] [--dispatcher] [--once]
 *
 * Identities (ADR-0003): BBC_ENGINE_SVC (BBC_ENGINE_PAT) for every API procedure;
 * BBC_AGENT_SVC (BBC_AGENT_PAT) only to invoke Cortex Agents. Neither holds table
 * privileges. Targets: the carrier TMS (BBC_TMS_URL) and SAP S/4 (BBC_SAP_URL, BBC_SAP_KEY_MAP).
 */

import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { createSqlEnginePort } from "@blueberrychain/bbc-api";
import { TmsClient, carrierHandlers } from "@blueberrychain/connector-carrier";
import { ODataWriter, loadKeyMap, sapHandlers } from "@blueberrychain/connector-sap-s4";
import type { ActionHandler } from "@blueberrychain/connector-sdk";
import { SqlApiClient, sqlApiConfigFromEnv } from "@blueberrychain/shared";
import { CortexAgentProvider } from "./agents.js";
import { Dispatcher, HandlerRegistry } from "./dispatch.js";
import { jsonLogger } from "./log.js";
import { TraceHub, createRelayServer } from "./relay.js";
import { Worker } from "./worker.js";

const env = process.env;
const args = new Set(process.argv.slice(2));
const roles = { worker: args.has("--worker") || !args.has("--dispatcher"), dispatcher: args.has("--dispatcher") || !args.has("--worker") };
const once = args.has("--once");
const engineId = env["BBC_ENGINE_ID"] ?? `${hostname()}-${process.pid}`;
const log = jsonLogger;

const client = new SqlApiClient({ ...sqlApiConfigFromEnv("BBC_ENGINE_PAT", "BBC_ENGINE", env), queryTag: "bbc-engine" });
const port = createSqlEnginePort(client);
const hub = new TraceHub();
const controller = new AbortController();
const tasks: Promise<void>[] = [];

if (roles.worker) {
  const provider = new CortexAgentProvider({
    account: env["SNOWFLAKE_ACCOUNT"] ?? "",
    ...(env["SNOWFLAKE_HOST"] ? { host: env["SNOWFLAKE_HOST"] } : {}),
    token: env["BBC_AGENT_PAT"] ?? "",
    timeoutMs: Number(env["BBC_AGENT_TIMEOUT_MS"] ?? 300_000),
  });
  const slots = Number(env["BBC_ENGINE_WORKERS"] ?? 2);
  for (let i = 0; i < slots; i++) {
    const worker = new Worker({ id: `${engineId}/worker-${i}`, port, provider, hub, log, leaseS: Number(env["BBC_ENGINE_LEASE_S"] ?? 120) });
    tasks.push(once ? worker.step().then(() => undefined) : worker.run(controller.signal));
  }
}

if (roles.dispatcher) {
  const handlers: ActionHandler<never>[] = [];
  if (env["BBC_TMS_URL"]) handlers.push(...(carrierHandlers(new TmsClient({ baseUrl: env["BBC_TMS_URL"], token: env["BBC_TMS_TOKEN"] ?? "" })) as ActionHandler<never>[]));
  if (env["BBC_SAP_URL"]) {
    const writer = new ODataWriter({ baseUrl: env["BBC_SAP_URL"], user: env["BBC_SAP_USER"] ?? "", password: env["BBC_SAP_PASSWORD"] ?? "" });
    // The same SAP key map the ingest connector uses (plants <-> sites).
    const keys = loadKeyMap(env["BBC_SAP_KEY_MAP"] ?? "../../.artifacts/sim/reference/sap_key_map.json");
    handlers.push(...(sapHandlers(writer, keys) as ActionHandler<never>[]));
  }
  const registry = new HandlerRegistry(handlers);
  log("info", "dispatcher_ready", { dispatcher_id: `${engineId}/dispatcher`, handlers: registry.supported().join(",") });
  const dispatcher = new Dispatcher({
    id: `${engineId}/dispatcher`, port, registry, log, batch: Number(env["BBC_DISPATCH_BATCH"] ?? 10), leaseS: Number(env["BBC_DISPATCH_LEASE_S"] ?? 300),
  });
  tasks.push(once ? dispatcher.tick().then(() => undefined) : dispatcher.run(controller.signal));
}

const relayToken = env["BBC_ENGINE_RELAY_TOKEN"] ?? randomBytes(24).toString("base64url");
const relayPort = Number(env["BBC_ENGINE_RELAY_PORT"] ?? 8791);
const relay = createRelayServer(hub, relayToken);
if (roles.worker && !once) {
  relay.listen(relayPort, "127.0.0.1", () => {
    log("info", "relay_listening", { url: `http://127.0.0.1:${relayPort}`, token_configured: Boolean(env["BBC_ENGINE_RELAY_TOKEN"]) });
  });
}

const drainMs = Number(env["BBC_ENGINE_DRAIN_MS"] ?? 20_000);
const stop = (signal: string) => {
  if (controller.signal.aborted) return;
  log("info", "stopping", { signal, drain_ms: drainMs });
  controller.abort();
  relay.close();
  setTimeout(() => process.exit(0), drainMs).unref();
};
for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(s, () => stop(s));

log("info", "engine_started", { engine_id: engineId, worker: roles.worker, dispatcher: roles.dispatcher, once });
await Promise.all(tasks);
relay.close();
log("info", "engine_stopped", { engine_id: engineId });
