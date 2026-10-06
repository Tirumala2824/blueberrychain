import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqlApiClient, SqlApiError } from "@blueberrychain/shared";
import { describe, expect, it } from "vitest";
import { BatchingWriter, FileDeadLetter } from "./batching.js";
import { businessEventRow, rowProblems, telemetryRow } from "./rows.js";
import { MemorySink, SnowflakeSink } from "./sinks.js";
import { syncSource } from "./sync.js";
import { IngestRefusedError, type PullSource, type TelemetryRow } from "./types.js";

const CONNECTOR = "iot-webhook";

function reading(minute: number, pulp = 0.8, device = "P-A1"): TelemetryRow {
  const ts = `2026-10-06T08:${String(minute).padStart(2, "0")}:00Z`;
  return telemetryRow({ connectorId: CONNECTOR, deviceId: device, readingTs: ts, intervalS: 300, readings: { pulp_c: pulp } });
}

describe("rows", () => {
  it("computes the shared idempotency key", () => {
    const row = telemetryRow({
      connectorId: CONNECTOR,
      deviceId: "P-A1",
      readingTs: "2026-10-06T13:25:00+05:30",
      intervalS: 300,
      readings: { pulp_c: 0.8 },
    });
    expect(row.idempotency_key).toBe("606ba4d4e8a987454bc6a0a1d766118111d5b16bd7ad42409ac46e7e01e34bf4");
    expect(rowProblems("TELEMETRY", CONNECTOR, row)).toEqual([]);
  });

  it("finds the same problems the server would", () => {
    const forged = { ...reading(0), idempotency_key: "0".repeat(64) };
    expect(rowProblems("TELEMETRY", CONNECTOR, forged)[0]).toBe(
      `/idempotency_key: expected ${reading(0).idempotency_key}`,
    );
    expect(rowProblems("TELEMETRY", "sap-s4", reading(0))[0]).toMatch(/does not match/);
    expect(rowProblems("TELEMETRY", CONNECTOR, reading(0, 99))[0]).toMatch(/^\/readings\/pulp_c/);
    const lot = businessEventRow({
      connectorId: "sap-s4",
      sourceSystem: "SAP",
      entityType: "LOT",
      externalId: "L-A",
      eventTs: "2026-10-06T06:00:00Z",
      payload: { lot_id: "L-A" },
    });
    expect(rowProblems("BUSINESS_EVENTS", "sap-s4", lot).join(" ")).toMatch(/product_id/);
  });
});

describe("MemorySink", () => {
  it("de-duplicates on the key, so a replayed batch inserts nothing", async () => {
    const sink = new MemorySink(CONNECTOR);
    const batch = [reading(0), reading(5), reading(5)];
    expect(await sink.write("TELEMETRY", batch)).toMatchObject({ inserted: 2, duplicates: 1, status: "OK" });
    expect(await sink.write("TELEMETRY", batch)).toMatchObject({ inserted: 0, duplicates: 3 });
    expect(sink.tables.TELEMETRY.size).toBe(2);
  });
});

describe("SnowflakeSink", () => {
  function client(responses: unknown[], seen: Array<{ body: Record<string, unknown> }>) {
    return new SqlApiClient({
      account: "acct",
      token: "tok",
      role: "BBC_INGEST",
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push({ body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ data: [[JSON.stringify(responses.shift())]] }), { status: 200 });
      }) as typeof fetch,
    });
  }

  it("calls API.INGEST_BATCH with the batch as one JSON binding", async () => {
    const seen: Array<{ body: Record<string, unknown> }> = [];
    const ok = { status: "OK", target: "TELEMETRY", received: 1, inserted: 1, duplicates: 0, rejected: 0, rejects: [] };
    const sink = new SnowflakeSink(CONNECTOR, client([ok], seen));
    await expect(sink.write("TELEMETRY", [reading(0)], { stream: "s", cursor: "c" })).resolves.toMatchObject(ok);
    const body = seen[0]!.body as { statement: string; bindings: Record<string, { value: string }> };
    expect(body.statement).toBe("CALL BBC_OS.API.INGEST_BATCH(?, ?, PARSE_JSON(?), ?, ?)");
    expect(body.bindings["1"]!.value).toBe("TELEMETRY");
    expect(body.bindings["2"]!.value).toBe(CONNECTOR);
    expect(JSON.parse(body.bindings["3"]!.value)).toEqual([reading(0)]);
    expect([body.bindings["4"]!.value, body.bindings["5"]!.value]).toEqual(["s", "c"]);
  });

  it("raises IngestRefusedError when the server refuses the batch", async () => {
    const sink = new SnowflakeSink(CONNECTOR, client([{ status: "INVALID", errors: ["ROWS has 6000 rows"] }], []));
    await expect(sink.write("TELEMETRY", [reading(0)])).rejects.toBeInstanceOf(IngestRefusedError);
  });

  it("reads committed cursors", async () => {
    const state = { status: "OK", streams: { lots: { cursor_value: "c1", updated_at: "t" } } };
    const sink = new SnowflakeSink("sap-s4", client([state], []));
    expect(await sink.cursors()).toEqual({ lots: "c1" });
  });
});

describe("BatchingWriter", () => {
  it("sends full batches immediately and resolves each caller with its own rejects", async () => {
    const sink = new MemorySink(CONNECTOR);
    const writer = new BatchingWriter(sink, "TELEMETRY", { maxRows: 3, maxDelayMs: 10_000 });
    const a = writer.write([reading(0), reading(5, 99)]);
    const b = writer.write([reading(10)]);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.accepted).toBe(1);
    expect(ra.rejected.map((r) => r.row.reading_ts)).toEqual(["2026-10-06T08:05:00Z"]);
    expect(rb).toEqual({ accepted: 1, rejected: [] });
    expect(sink.batches).toHaveLength(1);
    await writer.close();
  });

  it("flushes a partial batch after maxDelayMs", async () => {
    const sink = new MemorySink(CONNECTOR);
    const writer = new BatchingWriter(sink, "TELEMETRY", { maxRows: 100, maxDelayMs: 20 });
    const started = Date.now();
    await writer.write([reading(0)]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(sink.batches).toHaveLength(1);
  });

  it("splits a large write and resolves only when every part is committed", async () => {
    const sink = new MemorySink(CONNECTOR);
    const writer = new BatchingWriter(sink, "TELEMETRY", { maxRows: 4, maxDelayMs: 5 });
    const rows = Array.from({ length: 10 }, (_, i) => reading(i));
    expect(await writer.write(rows)).toEqual({ accepted: 10, rejected: [] });
    expect(sink.batches.map((b) => b.received)).toEqual([4, 4, 2]);
    expect(writer.stats).toMatchObject({ batches: 3, inserted: 10 });
  });

  it("retries a retryable failure and then succeeds", async () => {
    const sink = new MemorySink(CONNECTOR);
    sink.failNext = { count: 2, error: new SqlApiError("busy", 503, true) };
    const writer = new BatchingWriter(sink, "TELEMETRY", { maxDelayMs: 1, backoffMs: 1, maxAttempts: 3 });
    expect(await writer.write([reading(0)])).toEqual({ accepted: 1, rejected: [] });
  });

  it("dead-letters a batch that cannot be written and rejects its callers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bbc-dlq-"));
    const sink = new MemorySink(CONNECTOR);
    sink.failNext = { count: 1, error: new IngestRefusedError(["CONNECTOR_ID must match"]) };
    const writer = new BatchingWriter(sink, "TELEMETRY", { maxDelayMs: 1, deadLetter: new FileDeadLetter(dir) });
    await expect(writer.write([reading(0)])).rejects.toBeInstanceOf(IngestRefusedError);
    const lines = readFileSync(join(dir, `${CONNECTOR}.jsonl`), "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ connectorId: CONNECTOR, target: "TELEMETRY" });
    expect(entry.rows).toHaveLength(1);
    expect(writer.stats.failedBatches).toBe(1);
  });

  it("refuses writes after close", async () => {
    const writer = new BatchingWriter(new MemorySink(CONNECTOR), "TELEMETRY");
    await writer.close();
    await expect(writer.write([reading(0)])).rejects.toThrow(/closed/);
  });
});

describe("syncSource", () => {
  const lots = Array.from({ length: 5 }, (_, i) =>
    businessEventRow({
      connectorId: "sap-s4",
      sourceSystem: "SAP",
      entityType: "LOT",
      externalId: `L-${i}`,
      eventTs: `2026-10-06T0${i}:00:00Z`,
      payload: {
        lot_id: `L-${i}`,
        product_id: "BB-EMERALD-ORG-12x6",
        grower_party_id: "PARTY-EMERALD-RIDGE",
        harvest_site_id: "SITE-RANCH14-B7",
        harvest_at: `2026-10-06T0${i}:00:00Z`,
        kg: 1000,
        organic: true,
      },
    }),
  );

  /** Pages of two rows ordered by event_ts; the cursor is the last event_ts on the page. */
  function source(failAfterPages = Infinity): PullSource & { pulls: number } {
    return {
      target: "BUSINESS_EVENTS",
      streams: ["lots"],
      pulls: 0,
      async pull(_stream, cursor) {
        if (++this.pulls > failAfterPages) throw new Error("source went away");
        const rest = lots.filter((r) => cursor === null || r.event_ts > cursor);
        const rows = rest.slice(0, 2);
        return { rows, cursor: rows.at(-1)?.event_ts ?? cursor, more: rest.length > 2 };
      },
    };
  }

  it("commits each page with its cursor", async () => {
    const sink = new MemorySink("sap-s4");
    const [report] = await syncSource(source(), sink);
    expect(report).toMatchObject({ pages: 3, rows: 5, inserted: 5, cursor: "2026-10-06T04:00:00Z" });
    expect(await sink.cursors()).toEqual({ lots: "2026-10-06T04:00:00Z" });
  });

  it("resumes from the committed cursor after a crash without duplicating", async () => {
    const sink = new MemorySink("sap-s4");
    await expect(syncSource(source(1), sink)).rejects.toThrow(/went away/);
    expect(sink.tables.BUSINESS_EVENTS.size).toBe(2);
    const [report] = await syncSource(source(), sink);
    expect(report).toMatchObject({ rows: 3, inserted: 3, duplicates: 0 });
    expect(sink.tables.BUSINESS_EVENTS.size).toBe(5);
  });
});

const live = process.env.BBC_IT === "1" && process.env.BBC_INGEST_PAT;
describe.skipIf(!live)("SnowflakeSink against the account (BBC_IT=1)", () => {
  it("lands a batch once, then replays it as duplicates", async () => {
    const sink = SnowflakeSink.fromEnv("it-connector-sdk");
    const ts = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const row = telemetryRow({
      connectorId: "it-connector-sdk",
      deviceId: "P-IT",
      readingTs: ts,
      intervalS: 60,
      provenance: "SIMULATION_LIVE",
      readings: { pulp_c: 1.0 },
    });
    expect(await sink.write("TELEMETRY", [row])).toMatchObject({ inserted: 1 });
    expect(await sink.write("TELEMETRY", [row])).toMatchObject({ inserted: 0, duplicates: 1 });
  }, 60_000); // a cold Python procedure takes several seconds on its first call
});
