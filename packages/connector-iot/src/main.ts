#!/usr/bin/env node
/**
 * Run the IoT webhook. Configuration (see .env.example):
 *   BBC_IOT_HMAC_SECRET   shared secret with the device platform (required)
 *   BBC_IOT_PORT          default 8787; BBC_IOT_HOST default 127.0.0.1
 *   BBC_IOT_CONNECTOR_ID  default iot-webhook
 *   BBC_IOT_SINK          snowflake (default; BBC_INGEST_SVC's PAT) or memory (local dry runs)
 *   BBC_DEAD_LETTER_DIR   default .artifacts/dead-letter
 */

import { BatchingWriter, FileDeadLetter, MemorySink, SnowflakeSink, type Sink } from "@blueberrychain/connector-sdk";
import { createIotServer } from "./server.js";

const env = process.env;
const secret = env.BBC_IOT_HMAC_SECRET;
if (!secret) {
  console.error("BBC_IOT_HMAC_SECRET is not set (see .env.example)");
  process.exit(1);
}
const connectorId = env.BBC_IOT_CONNECTOR_ID ?? "iot-webhook";
const sink: Sink = env.BBC_IOT_SINK === "memory" ? new MemorySink(connectorId) : SnowflakeSink.fromEnv(connectorId);
const writer = new BatchingWriter(sink, "TELEMETRY", {
  maxRows: 500,
  maxDelayMs: 1000,
  deadLetter: new FileDeadLetter(env.BBC_DEAD_LETTER_DIR ?? ".artifacts/dead-letter"),
});
const eventWriter = new BatchingWriter(sink, "BUSINESS_EVENTS", {
  maxRows: 200,
  maxDelayMs: 500,
  deadLetter: new FileDeadLetter(env.BBC_DEAD_LETTER_DIR ?? ".artifacts/dead-letter"),
});
const server = createIotServer({ connectorId, secret, writer, eventWriter });
const port = Number(env.BBC_IOT_PORT ?? 8787);
const host = env.BBC_IOT_HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(JSON.stringify({ event: "listening", url: `http://${host}:${port}/v1/telemetry`, sink: sink.constructor.name }));
});

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "shutdown", signal }));
  server.close();
  await writer.close();
  await eventWriter.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
