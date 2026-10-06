import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { BatchingWriter, MemorySink } from "@blueberrychain/connector-sdk";
import { contractsDir, SqlApiError } from "@blueberrychain/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createIotServer } from "./server.js";
import { sign, verify } from "./signature.js";

const SECRET = "bbc-test-secret";
const NOW = 1_791_273_300;

const vectors = JSON.parse(readFileSync(join(contractsDir(), "vectors", "webhook_signature.json"), "utf-8"))
  .vectors as Array<{ secret: string; timestamp: string; body: string; signature: string }>;

describe("signature", () => {
  it("reproduces the shared vector", () => {
    for (const v of vectors) {
      expect(sign(v.secret, v.timestamp, v.body)).toBe(v.signature);
      expect(verify(v.secret, v.timestamp, v.signature, v.body, Number(v.timestamp))).toEqual({ ok: true });
    }
  });

  it("refuses tampering, other secrets, stale requests and missing headers", () => {
    const v = vectors[0]!;
    const now = Number(v.timestamp);
    expect(verify(v.secret, v.timestamp, v.signature, v.body + " ", now)).toMatchObject({ ok: false });
    expect(verify("other", v.timestamp, v.signature, v.body, now)).toMatchObject({ ok: false });
    expect(verify(v.secret, v.timestamp, v.signature, v.body, now + 301)).toMatchObject({
      reason: "timestamp outside tolerance",
    });
    expect(verify(v.secret, undefined, v.signature, v.body, now)).toMatchObject({ ok: false });
    expect(verify(v.secret, v.timestamp, undefined, v.body, now)).toMatchObject({ ok: false });
  });
});

const batch = {
  source: "bbc-sim",
  messages: [0, 5, 10].map((m) => ({
    device_id: "P-A1",
    ts: `2026-10-06T08:${String(m).padStart(2, "0")}:00Z`,
    interval_s: 300,
    values: { pulp_c: 0.8 + m / 10 },
    provenance: "SIMULATION_LIVE",
  })),
};

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function start(sink = new MemorySink("iot-webhook")) {
  const writer = new BatchingWriter(sink, "TELEMETRY", { maxDelayMs: 5, backoffMs: 1, maxAttempts: 1 });
  const server = createIotServer({ connectorId: "iot-webhook", secret: SECRET, writer, nowS: () => NOW, log: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { sink, url };
}

async function post(url: string, body: unknown, opts: { secret?: string; ts?: number } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ts = String(opts.ts ?? NOW);
  const res = await fetch(`${url}/v1/telemetry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BBC-Timestamp": ts,
      "X-BBC-Signature": sign(opts.secret ?? SECRET, ts, text),
    },
    body: text,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("IoT webhook", () => {
  it("lands a signed batch and acknowledges after the commit", async () => {
    const { sink, url } = await start();
    const res = await post(url, batch);
    expect(res).toEqual({ status: 200, body: { accepted: 3, rejected: [] } });
    const rows = [...sink.tables.TELEMETRY.values()];
    expect(rows.map((r) => r.reading_ts)).toEqual(batch.messages.map((m) => m.ts));
    expect(rows[0]).toMatchObject({ device_id: "P-A1", interval_s: 300, connector_id: "iot-webhook" });
  });

  it("treats a resent batch as duplicates, so retries never double-count", async () => {
    const { sink, url } = await start();
    await post(url, batch);
    const again = await post(url, batch);
    expect(again.status).toBe(200);
    expect(sink.tables.TELEMETRY.size).toBe(3);
    expect(sink.batches.at(-1)).toMatchObject({ inserted: 0, duplicates: 3 });
  });

  it("refuses unsigned, mis-signed and stale requests", async () => {
    const { sink, url } = await start();
    expect((await post(url, batch, { secret: "wrong" })).status).toBe(401);
    expect((await post(url, batch, { ts: NOW - 3600 })).status).toBe(401);
    const res = await fetch(`${url}/v1/telemetry`, { method: "POST", body: JSON.stringify(batch) });
    expect(res.status).toBe(401);
    expect(sink.tables.TELEMETRY.size).toBe(0);
  });

  it("rejects bodies that break the webhook contract", async () => {
    const { url } = await start();
    const bad = await post(url, { messages: [{ device_id: "P-A1", ts: "2026-10-06T08:00:00Z", values: {} }] });
    expect(bad.status).toBe(400);
    expect(String((bad.body.details as string[])[0])).toMatch(/interval_s|values/);
    expect((await post(url, "{not json")).status).toBe(400);
  });

  it("answers 503 when the sink is down, so the platform retries", async () => {
    const sink = new MemorySink("iot-webhook");
    sink.failNext = { count: 1, error: new SqlApiError("down", 503, true) };
    const { url } = await start(sink);
    expect((await post(url, batch)).status).toBe(503);
    expect((await post(url, batch)).status).toBe(200);
    expect(sink.tables.TELEMETRY.size).toBe(3);
  });

  it("reports health and refuses unknown routes", async () => {
    const { url } = await start();
    const health = await fetch(`${url}/healthz`);
    expect(await health.json()).toMatchObject({ status: "ok", connector_id: "iot-webhook" });
    expect((await fetch(`${url}/v1/other`, { method: "POST" })).status).toBe(404);
  });
});
