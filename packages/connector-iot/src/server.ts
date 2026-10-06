/**
 * The IoT webhook: POST /v1/telemetry with a signed batch (contracts/schemas/connectors/iot_webhook.json).
 *
 * The response is sent only after the rows are committed in RAW, so a 200 means the
 * readings are durable and a 503 tells the platform to retry. Retries are safe:
 * every reading's idempotency key is derived from (device_id, ts).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type BatchingWriter, type TelemetryRow, telemetryRow } from "@blueberrychain/connector-sdk";
import { validate } from "@blueberrychain/shared";
import { DEFAULT_TOLERANCE_S, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./signature.js";

export const WEBHOOK_SCHEMA = "connectors/iot_webhook.json";

export interface WebhookMessage {
  device_id: string;
  ts: string;
  interval_s: number;
  values: TelemetryRow["readings"];
  provenance?: TelemetryRow["provenance"];
}

export interface IotServerOptions {
  connectorId: string;
  secret: string;
  writer: BatchingWriter;
  maxBodyBytes?: number;
  toleranceS?: number;
  nowS?: () => number;
  log?: (event: Record<string, unknown>) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, { error: `body exceeds ${limit} bytes` }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

export function toRows(connectorId: string, messages: WebhookMessage[]): TelemetryRow[] {
  return messages.map((m) =>
    telemetryRow({
      connectorId,
      deviceId: m.device_id,
      readingTs: m.ts,
      intervalS: m.interval_s,
      readings: m.values,
      ...(m.provenance ? { provenance: m.provenance } : {}),
    }),
  );
}

export function createIotServer(options: IotServerOptions): Server {
  const log = options.log ?? ((event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event })));
  const nowS = options.nowS ?? (() => Math.floor(Date.now() / 1000));
  const limit = options.maxBodyBytes ?? 5 * 1024 * 1024;

  async function telemetry(req: IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await readBody(req, limit);
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const check = verify(
      options.secret,
      header(TIMESTAMP_HEADER),
      header(SIGNATURE_HEADER),
      raw,
      nowS(),
      options.toleranceS ?? DEFAULT_TOLERANCE_S,
    );
    if (!check.ok) throw new HttpError(401, { error: check.reason });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, { error: "body is not JSON" });
    }
    const problems = validate(WEBHOOK_SCHEMA, body);
    if (problems.length) {
      throw new HttpError(400, {
        error: "batch does not match connectors/iot_webhook.json",
        details: problems.slice(0, 20).map((p) => `${p.path}: ${p.message}`),
      });
    }
    const messages = (body as { messages: WebhookMessage[] }).messages;
    let outcome;
    try {
      outcome = await options.writer.write(toRows(options.connectorId, messages));
    } catch (error) {
      log({ event: "ingest_failed", error: (error as Error).message, messages: messages.length });
      throw new HttpError(503, { error: "ingest unavailable; retry the same batch" });
    }
    log({ event: "batch", messages: messages.length, accepted: outcome.accepted, rejected: outcome.rejected.length });
    return {
      accepted: outcome.accepted,
      rejected: outcome.rejected.map((r) => ({
        device_id: (r.row as TelemetryRow).device_id,
        ts: (r.row as TelemetryRow).reading_ts,
        errors: r.errors,
      })),
    };
  }

  return createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      send(res, 200, { status: "ok", connector_id: options.connectorId, stats: options.writer.stats });
      return;
    }
    if (req.method !== "POST" || path !== "/v1/telemetry") {
      send(res, 404, { error: "not found" });
      return;
    }
    telemetry(req).then(
      (body) => send(res, 200, body),
      (error: unknown) => {
        if (error instanceof HttpError) send(res, error.status, error.body);
        else {
          log({ event: "error", error: String(error) });
          send(res, 500, { error: "internal error" });
        }
      },
    );
  });
}
