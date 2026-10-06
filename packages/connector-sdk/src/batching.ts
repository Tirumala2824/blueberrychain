/**
 * BatchingWriter: collects rows from push sources into batches for a Sink.
 *
 * - A batch is sent when it reaches `maxRows`, or `maxDelayMs` after its first row.
 * - `write()` resolves only after every row it was given has been committed (or
 *   dead-lettered by the server), so a webhook can acknowledge its caller truthfully:
 *   at-least-once delivery plus server-side de-duplication means effectively once.
 * - Batches are sent one at a time, in order. Retryable failures are retried with
 *   backoff; a batch that still fails goes to the local dead-letter store and its
 *   callers' promises reject.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { IngestResult, RawRow, RawTarget, Sink } from "./types.js";

export interface DeadLetterEntry {
  at: string;
  connectorId: string;
  target: RawTarget;
  error: string;
  rows: RawRow[];
}

export interface DeadLetterStore {
  record(entry: DeadLetterEntry): Promise<void>;
}

/** Appends failed batches as JSON lines to `<dir>/<connectorId>.jsonl` for later replay. */
export class FileDeadLetter implements DeadLetterStore {
  constructor(private readonly dir: string) {}

  async record(entry: DeadLetterEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(join(this.dir, `${entry.connectorId}.jsonl`), JSON.stringify(entry) + "\n", "utf-8");
  }
}

export interface WriteOutcome {
  /** Rows committed to RAW (new or already present). */
  accepted: number;
  /** Rows the server dead-lettered, with its reasons. */
  rejected: Array<{ row: RawRow; errors: string[] }>;
}

export interface BatchingOptions {
  maxRows?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  deadLetter?: DeadLetterStore;
  onBatch?: (result: IngestResult) => void;
}

interface Ticket {
  total: number;
  pending: number;
  rejected: WriteOutcome["rejected"];
  settled: boolean;
  resolve: (outcome: WriteOutcome) => void;
  reject: (error: Error) => void;
}

interface Piece {
  ticket: Ticket;
  rows: RawRow[];
}

export interface WriterStats {
  batches: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  failedBatches: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch network failure
  return typeof error === "object" && error !== null && (error as { retryable?: unknown }).retryable === true;
}

export class BatchingWriter {
  readonly stats: WriterStats = { batches: 0, inserted: 0, duplicates: 0, rejected: 0, failedBatches: 0 };
  private readonly maxRows: number;
  private readonly maxDelayMs: number;
  private readonly queue: Piece[] = [];
  private queuedRows = 0;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly sink: Sink,
    private readonly target: RawTarget,
    private readonly options: BatchingOptions = {},
  ) {
    this.maxRows = options.maxRows ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 1000;
  }

  write(rows: RawRow[]): Promise<WriteOutcome> {
    if (this.closed) return Promise.reject(new Error("BatchingWriter is closed"));
    if (!rows.length) return Promise.resolve({ accepted: 0, rejected: [] });
    return new Promise<WriteOutcome>((resolve, reject) => {
      const pieces = Math.ceil(rows.length / this.maxRows);
      const ticket: Ticket = { total: rows.length, pending: pieces, rejected: [], settled: false, resolve, reject };
      for (let i = 0; i < rows.length; i += this.maxRows) {
        this.queue.push({ ticket, rows: rows.slice(i, i + this.maxRows) });
      }
      this.queuedRows += rows.length;
      if (this.queuedRows >= this.maxRows) this.kick();
      else if (!this.timer) this.timer = setTimeout(() => this.kick(), this.maxDelayMs);
    });
  }

  /** Send everything queued and wait for it. */
  async flush(): Promise<void> {
    this.kick();
    while (this.draining) await this.draining;
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }

  private kick(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const batch: Piece[] = [];
      let size = 0;
      while (this.queue.length && size + this.queue[0]!.rows.length <= this.maxRows) {
        const piece = this.queue.shift()!;
        batch.push(piece);
        size += piece.rows.length;
      }
      this.queuedRows -= size;
      await this.send(batch);
    }
  }

  private async send(batch: Piece[]): Promise<void> {
    const rows = batch.flatMap((p) => p.rows);
    const maxAttempts = this.options.maxAttempts ?? 3;
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.sink.write(this.target, rows);
        this.settle(batch, result);
        return;
      } catch (error) {
        if (isRetryable(error) && attempt < maxAttempts) {
          await sleep((this.options.backoffMs ?? 500) * 2 ** (attempt - 1));
          continue;
        }
        await this.fail(batch, rows, error as Error);
        return;
      }
    }
  }

  private settle(batch: Piece[], result: IngestResult): void {
    this.stats.batches += 1;
    this.stats.inserted += result.inserted;
    this.stats.duplicates += result.duplicates;
    this.stats.rejected += result.rejected;
    this.options.onBatch?.(result);
    const byIndex = new Map(result.rejects.map((r) => [r.index, r.errors]));
    let offset = 0;
    for (const piece of batch) {
      piece.rows.forEach((row, i) => {
        const errors = byIndex.get(offset + i);
        if (errors) piece.ticket.rejected.push({ row, errors });
      });
      offset += piece.rows.length;
      const ticket = piece.ticket;
      ticket.pending -= 1;
      if (ticket.pending === 0 && !ticket.settled) {
        ticket.settled = true;
        ticket.resolve({ accepted: ticket.total - ticket.rejected.length, rejected: ticket.rejected });
      }
    }
  }

  private async fail(batch: Piece[], rows: RawRow[], error: Error): Promise<void> {
    this.stats.failedBatches += 1;
    try {
      await this.options.deadLetter?.record({
        at: new Date().toISOString(),
        connectorId: this.sink.connectorId,
        target: this.target,
        error: error.message,
        rows,
      });
    } finally {
      for (const piece of batch) {
        if (!piece.ticket.settled) {
          piece.ticket.settled = true;
          piece.ticket.reject(error);
        }
      }
    }
  }
}
