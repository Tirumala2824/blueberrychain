/**
 * Connector SDK contracts. A connector moves records from an external system into RAW
 * (inbound) or applies governed mutations to it (outbound, Day 7):
 *
 * - inbound **push** sources (IoT webhook) hand rows to a {@link BatchingWriter};
 * - inbound **pull** sources (SAP OData, TMS) implement {@link PullSource} and run under
 *   `syncSource`, which commits each page together with its cursor;
 * - outbound connectors implement {@link ActionHandler} for the engine's dispatcher.
 *
 * Every write lands through `BBC_OS.API.INGEST_BATCH`, which validates, de-duplicates
 * on the idempotency key and dead-letters bad rows server-side.
 */

import type { RawBusinessEvent, RawTelemetryReading } from "@blueberrychain/shared";

export type TelemetryRow = RawTelemetryReading.RAWTELEMETRYRow;
export type BusinessEventRow = RawBusinessEvent.RAWBUSINESS_EVENTSRow;
export type RawTarget = "TELEMETRY" | "BUSINESS_EVENTS";
export type RawRow = TelemetryRow | BusinessEventRow;

export interface IngestReject {
  /** Index of the row in the batch that was sent. */
  index: number;
  errors: string[];
}

/** What `API.INGEST_BATCH` reports for one committed batch. */
export interface IngestResult {
  status: "OK" | "PARTIAL";
  target: RawTarget;
  received: number;
  inserted: number;
  /** Rows already in RAW (or repeated inside the batch): a retry or replay, not new data. */
  duplicates: number;
  /** Rows dead-lettered to RAW.INGEST_ERRORS. */
  rejected: number;
  rejects: IngestReject[];
  stream: string | null;
  cursor_value: string | null;
}

export interface WriteOptions {
  /** Cursor stream this batch advances (pull sources); omit for push sources. */
  stream?: string;
  /** The cursor value covering every row in the batch; committed in the same transaction. */
  cursor?: string;
}

export interface Sink {
  readonly connectorId: string;
  write(target: RawTarget, rows: RawRow[], options?: WriteOptions): Promise<IngestResult>;
  /** Committed cursors per stream for this connector. */
  cursors(): Promise<Record<string, string | null>>;
}

/** Raised when the server refuses a whole batch (nothing was written). Never retried. */
export class IngestRefusedError extends Error {
  constructor(readonly errors: string[]) {
    super(`ingest refused: ${errors.join("; ")}`);
    this.name = "IngestRefusedError";
  }
}

export interface PullPage<Row extends RawRow = RawRow> {
  rows: Row[];
  /** Cursor that covers these rows; stored with them. */
  cursor: string | null;
  /** True when the source has more pages after this one. */
  more: boolean;
}

export interface PullSource<Row extends RawRow = RawRow> {
  readonly target: RawTarget;
  readonly streams: readonly string[];
  /** The page after `cursor` (null = from the beginning). */
  pull(stream: string, cursor: string | null): Promise<PullPage<Row>>;
}

/** Outbound side, used by the dispatcher (Day 7). The key makes every call safe to retry. */
export interface ActionHandler<Intent = Record<string, unknown>> {
  readonly actionTypes: readonly string[];
  /** Read the target's current state just before the write (observed_before). */
  readBefore(intent: Intent): Promise<Record<string, unknown>>;
  /** Apply the action; the target must treat a repeated key as the same request. */
  execute(intent: Intent, idempotencyKey: string): Promise<{ externalRef: string; response: unknown }>;
  /** Ask the target what happened to a key, before ever resending after a timeout. */
  status(idempotencyKey: string): Promise<"UNKNOWN" | "APPLIED" | "FAILED">;
  /** Read the target's state after the ACK (observed_after). */
  readAfter(intent: Intent, externalRef: string): Promise<Record<string, unknown>>;
}
