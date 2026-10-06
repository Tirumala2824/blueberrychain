import type { ExportResult, ReplayResult, VerifyLedgerResult } from "@blueberrychain/bbc-api";
import { humanizeCode } from "@/console/templates";
import { utc, utcSeconds } from "@/domain/format";
import { panel } from "./ui";
import styles from "./ProofResult.module.css";

type Ok<T> = Extract<T, { status: "OK" }>;

export function VerifyResult({ r }: { r: Ok<VerifyLedgerResult> }) {
  return (
    <div className={r.ok ? styles.ok : styles.broken} data-testid="verify-result" data-ok={String(r.ok)}>
      <p className={styles.verdict}>
        {r.ok ? `Chain intact: ${r.checked} entries recomputed, seq ${r.from_seq} to ${r.to_seq}.` : `Chain broken at seq ${r.first_bad_seq}: ${humanizeCode(r.reason ?? "unknown").toLowerCase()}.`}
      </p>
      <p className={styles.meta}>
        Recomputed in Snowflake on <span className="id">{r.ledger_table}</span> at {utcSeconds(r.verified_at)}
        {!r.ok && `; ${r.checked} entries verified before the break`}.
      </p>
      {r.bad_entry && (
        <p className={panel.hash}>
          Expected {r.bad_entry.expected_hash}
          <br />
          Found {r.bad_entry.actual_hash}
        </p>
      )}
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
