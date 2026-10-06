import type { ExportResult, ReplayResult, VerifyLedgerResult } from "@blueberrychain/bbc-api";
import { humanizeCode } from "@/console/templates";
import { utc } from "@/domain/format";
import { panel } from "./ui";
import styles from "./ProofResult.module.css";

type Ok<T> = Extract<T, { status: "OK" }>;

/** API.VERIFY_LEDGER recomputes every payload hash, entry hash and link of the whole table. */
export function VerifyResult({ r }: { r: VerifyLedgerResult }) {
  if (r.error) {
    return (
      <div className={styles.broken} data-testid="verify-result" data-ok="error">
        <p className={styles.verdict}>Snowflake couldn't verify this table.</p>
        <p className={styles.meta}>
          <span className="id">{r.table}</span>: {r.error}
        </p>
      </div>
    );
  }
  return (
    <div className={r.ok ? styles.ok : styles.broken} data-testid="verify-result" data-ok={String(r.ok)}>
      <p className={styles.verdict}>
        {r.ok ? `Chain intact: all ${r.entries ?? 0} entries recomputed.` : `Chain broken at seq ${r.first_bad_seq}: ${humanizeCode(r.reason ?? "unknown").toLowerCase()}.`}
      </p>
      <p className={styles.meta}>
        Recomputed in Snowflake on <span className="id">{r.table}</span>
        {!r.ok && r.first_bad_seq != null && `; every entry before seq ${r.first_bad_seq} still verifies`}.
      </p>
    </div>
  );
}

export function ReplayResultView({ r }: { r: Ok<ReplayResult> }) {
  return (
    <div className={r.equal ? styles.ok : styles.broken} data-testid="replay-result" data-equal={String(r.equal)}>
      <p className={styles.verdict}>
        {r.equal ? `Replay matches: ${r.pack_id} rebuilt as of ${utc(r.as_of)} hashes the same.` : `Replay differs: ${r.diff.length} field(s) changed.`}
      </p>
      <p className={panel.hash}>{r.replayed_hash}</p>
      {r.diff.length > 0 && (
        <ul>
          {r.diff.map((d) => (
            <li key={d.path}>
              <span className="id">{d.path}</span>: {JSON.stringify(d.original)} became {JSON.stringify(d.replayed)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExportResultView({ r }: { r: Ok<ExportResult> }) {
  return (
    <div className={styles.ok} data-testid="export-result">
      <p className={styles.verdict}>
        Evidence pack exported with ledger seq {r.ledger_from_seq} to {r.ledger_to_seq}.{" "}
        <a href={r.url} rel="noreferrer noopener" target="_blank">
          Download
        </a>{" "}
        (link valid until {utc(r.url_expires_at)})
      </p>
      <p className={panel.hash}>sha256 {r.sha256}</p>
    </div>
  );
}
