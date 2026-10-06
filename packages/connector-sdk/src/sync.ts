/** Pull-source runner: every page is committed together with the cursor that covers it. */

import type { PullSource, Sink } from "./types.js";

export interface StreamReport {
  stream: string;
  pages: number;
  rows: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  cursor: string | null;
}

/**
 * Bring every stream of `source` up to date. A crash between pages loses nothing and
 * duplicates nothing: the next run resumes from the last committed cursor, and a page
 * re-read after a crash is de-duplicated on its idempotency keys.
 */
export async function syncSource(
  source: PullSource,
  sink: Sink,
  options: { maxPages?: number } = {},
): Promise<StreamReport[]> {
  const committed = await sink.cursors();
  const reports: StreamReport[] = [];
  for (const stream of source.streams) {
    let cursor = committed[stream] ?? null;
    const report: StreamReport = { stream, pages: 0, rows: 0, inserted: 0, duplicates: 0, rejected: 0, cursor };
    for (let page = 0; page < (options.maxPages ?? 1000); page++) {
      const next = await source.pull(stream, cursor);
      report.pages += 1;
      if (next.rows.length) {
        const result = await sink.write(source.target, next.rows, {
          stream,
          cursor: next.cursor ?? cursor ?? "",
        });
        report.rows += next.rows.length;
        report.inserted += result.inserted;
        report.duplicates += result.duplicates;
        report.rejected += result.rejected;
      }
      cursor = next.cursor ?? cursor;
      if (!next.more) break;
    }
    report.cursor = cursor;
    reports.push(report);
  }
  return reports;
}
