/** Sinks: Snowflake (through API.INGEST_BATCH) and an in-memory twin with the same semantics. */

import { SqlApiClient, type SqlApiConfig, sqlApiConfigFromEnv } from "@blueberrychain/shared";
import { rowProblems } from "./rows.js";
import {
  IngestRefusedError,
  type IngestResult,
  type RawRow,
  type RawTarget,
  type Sink,
  type WriteOptions,
} from "./types.js";

const INGEST = "CALL BBC_OS.API.INGEST_BATCH(?, ?, ?, ?, ?)";
const STATE = "CALL BBC_OS.API.GET_CONNECTOR_STATE(?)";

type IngestResponse = IngestResult | { status: "INVALID"; errors: string[] };

export class SnowflakeSink implements Sink {
  private readonly client: SqlApiClient;

  constructor(
    readonly connectorId: string,
    config: SqlApiConfig | SqlApiClient,
  ) {
    this.client = config instanceof SqlApiClient ? config : new SqlApiClient(config);
  }

  /** Ingest identity from .env: BBC_INGEST_SVC's PAT, role BBC_INGEST. */
  static fromEnv(connectorId: string, env: Record<string, string | undefined> = process.env): SnowflakeSink {
    return new SnowflakeSink(connectorId, sqlApiConfigFromEnv("BBC_INGEST_PAT", "BBC_INGEST", env));
  }

  async write(target: RawTarget, rows: RawRow[], options: WriteOptions = {}): Promise<IngestResult> {
    const result = await this.client.callJson<IngestResponse>(INGEST, [
      target,
      this.connectorId,
      JSON.stringify(rows),
      options.stream ?? "",
      options.cursor ?? "",
    ]);
    if (result.status === "INVALID") throw new IngestRefusedError(result.errors);
    return result;
  }

  async cursors(): Promise<Record<string, string | null>> {
    const state = await this.client.callJson<{ streams: Record<string, { cursor_value: string | null }> }>(
      STATE,
      [this.connectorId],
    );
    return Object.fromEntries(Object.entries(state.streams).map(([s, v]) => [s, v.cursor_value]));
  }
}

/** An in-memory RAW that several connectors can share, as they share RAW in Snowflake. */
export interface MemoryRaw {
  tables: Record<RawTarget, Map<string, RawRow>>;
  deadLetters: Array<{ connectorId: string; target: RawTarget; row: RawRow; errors: string[] }>;
  /** connector id -> stream -> cursor (RAW.CONNECTOR_STATE). */
  cursors: Map<string, Map<string, string | null>>;
  batches: IngestResult[];
}

export function memoryRaw(): MemoryRaw {
  return { tables: { TELEMETRY: new Map(), BUSINESS_EVENTS: new Map() }, deadLetters: [], cursors: new Map(), batches: [] };
}

/** Same checks and de-duplication as the server; for tests and local (dev-stack) runs. */
export class MemorySink implements Sink {
  /** Make the next N writes throw this error (to exercise retries). */
  failNext: { count: number; error: Error } | null = null;

  constructor(
    readonly connectorId: string,
    readonly raw: MemoryRaw = memoryRaw(),
  ) {}

  get tables(): MemoryRaw["tables"] {
    return this.raw.tables;
  }

  get deadLetters(): MemoryRaw["deadLetters"] {
    return this.raw.deadLetters;
  }

  get batches(): IngestResult[] {
    return this.raw.batches;
  }

  /** This connector's committed cursors. */
  get cursorState(): Map<string, string | null> {
    let mine = this.raw.cursors.get(this.connectorId);
    if (!mine) {
      mine = new Map();
      this.raw.cursors.set(this.connectorId, mine);
    }
    return mine;
  }

  async write(target: RawTarget, rows: RawRow[], options: WriteOptions = {}): Promise<IngestResult> {
    if (this.failNext && this.failNext.count > 0) {
      this.failNext.count -= 1;
      throw this.failNext.error;
    }
    if (!rows.length) throw new IngestRefusedError(["ROWS must be a non-empty array"]);
    const table = this.tables[target];
    const seen = new Set<string>();
    let inserted = 0;
    let duplicates = 0;
    const rejects: IngestResult["rejects"] = [];
    rows.forEach((row, index) => {
      const errors = rowProblems(target, this.connectorId, row);
      if (errors.length) {
        rejects.push({ index, errors });
        this.deadLetters.push({ connectorId: this.connectorId, target, row, errors });
        return;
      }
      if (seen.has(row.idempotency_key) || table.has(row.idempotency_key)) {
        duplicates += 1;
        return;
      }
      seen.add(row.idempotency_key);
      table.set(row.idempotency_key, row);
      inserted += 1;
    });
    if (options.stream) this.cursorState.set(options.stream, options.cursor ?? null);
    const result: IngestResult = {
      status: rejects.length ? "PARTIAL" : "OK",
      target,
      received: rows.length,
      inserted,
      duplicates,
      rejected: rejects.length,
      rejects,
      stream: options.stream ?? null,
      cursor_value: options.stream ? (options.cursor ?? null) : null,
    };
    this.batches.push(result);
    return result;
  }

  async cursors(): Promise<Record<string, string | null>> {
    return Object.fromEntries(this.cursorState);
  }
}
