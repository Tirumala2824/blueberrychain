/**
 * The IoT webhook, both endpoints signed the same way:
 * - POST /v1/telemetry: readings (contracts/schemas/connectors/iot_webhook.json) -> RAW.TELEMETRY;
 * - POST /v1/pairings: device <-> lot / shipment pairings (connectors/iot_pairing.json) ->
 *   RAW.BUSINESS_EVENTS as DEVICE_ASSIGNMENT.
 *
 * The response is sent only after the rows are committed in RAW, so a 200 means the
 * data is durable and a 503 tells the platform to retry. Retries are safe: every
 * row's idempotency key is derived from its content's identity.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type BatchingWriter,
  type BusinessEventRow,
  businessEventRow,
  type TelemetryRow,
  telemetryRow,
} from "@blueberrychain/connector-sdk";
import { validate } from "@blueberrychain/shared";
import { DEFAULT_TOLERANCE_S, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./signature.js";

export const WEBHOOK_SCHEMA = "connectors/iot_webhook.json";
export const PAIRING_SCHEMA = "connectors/iot_pairing.json";

export interface WebhookMessage {
  device_id: string;
  ts: string;
  interval_s: number;
  values: TelemetryRow["readings"];
  provenance?: TelemetryRow["provenance"];
}

export interface Pairing {
  pairing_id: string;
  device_id: string;
  target_type: "LOT" | "SHIPMENT";
  target_id: string;
  role: "PRIMARY" | "SECONDARY" | "REEFER";
  assigned_from: string;
  assigned_to?: string | null;
  changed_at: string;
  provenance?: TelemetryRow["provenance"];
}

/** Each pairing version -> one DEVICE_ASSIGNMENT business event (latest version wins in OPS). */
export function toAssignments(connectorId: string, pairings: Pairing[]): BusinessEventRow[] {
  return pairings.map((p) =>
    businessEventRow({
      connectorId,
      sourceSystem: "IOT_PLATFORM",
      entityType: "DEVICE_ASSIGNMENT",
      externalId: p.pairing_id,
      eventTs: p.changed_at,
      payload: {
        device_id: p.device_id,
        target_type: p.target_type,
        target_id: p.target_id,
        role: p.role,
        assigned_from: p.assigned_from,
        ...(p.assigned_to ? { assigned_to: p.assigned_to } : {}),
      },
      ...(p.provenance ? { provenance: p.provenance } : {}),
    }),
  );
}

export interface IotServerOptions {
  connectorId: string;
  secret: string;
  writer: BatchingWriter;
  /** BUSINESS_EVENTS writer for /v1/pairings (optional: telemetry-only without it). */
  eventWriter?: BatchingWriter;
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

  /** Read, authenticate (HMAC) and contract-check a signed request body. */
  async function signedBody(req: IncomingMessage, schema: string): Promise<unknown> {
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
    const problems = validate(schema, body);
    if (problems.length) {
      throw new HttpError(400, {
        error: `batch does not match ${schema}`,
        details: problems.slice(0, 20).map((p) => `${p.path}: ${p.message}`),
      });
    }
    return body;
  }

  async function pairings(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!options.eventWriter) throw new HttpError(404, { error: "pairings are not enabled on this connector" });
    const body = (await signedBody(req, PAIRING_SCHEMA)) as { pairings: Pairing[] };
    let outcome;
    try {
      outcome = await options.eventWriter.write(toAssignments(options.connectorId, body.pairings));
    } catch (error) {
      log({ event: "ingest_failed", error: (error as Error).message, pairings: body.pairings.length });
      throw new HttpError(503, { error: "ingest unavailable; retry the same batch" });
    }
    log({ event: "pairings", pairings: body.pairings.length, accepted: outcome.accepted, rejected: outcome.rejected.length });
    return {
      accepted: outcome.accepted,
      rejected: outcome.rejected.map((r) => ({ pairing_id: (r.row as BusinessEventRow).external_id, errors: r.errors })),
    };
  }

  async function telemetry(req: IncomingMessage): Promise<Record<string, unknown>> {
    const body = await signedBody(req, WEBHOOK_SCHEMA);
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
      send(res, 200, {
        status: "ok",
        connector_id: options.connectorId,
        stats: options.writer.stats,
        ...(options.eventWriter ? { pairing_stats: options.eventWriter.stats } : {}),
      });
      return;
    }
    const handler = req.method === "POST" ? { "/v1/telemetry": telemetry, "/v1/pairings": pairings }[path ?? ""] : undefined;
    if (!handler) {
      send(res, 404, { error: "not found" });
      return;
    }
    handler(req).then(
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
