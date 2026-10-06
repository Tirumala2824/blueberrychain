"use client";

import type { CaseView } from "@blueberrychain/bbc-api";
import { useCockpit } from "@/components/cockpit/context";
import { Value } from "@/components/common/Value";
import { humanizeCode } from "@/console/templates";
import { partyName, usd, usdSigned, utc } from "@/domain/format";
import { KV, NotYet, PanelTitle, Section, panel } from "./ui";
import styles from "./OutcomePanel.module.css";

type Lot = CaseView["outcome"]["lots"][number];
type Claim = CaseView["outcome"]["claims"][number];

const CLAIM_PATH = ["NOTICE_SENT", "FILED", "RESPONDED", "SETTLED"];

function Compare({ lot }: { lot: Lot }) {
  const rows: [string, number | null, string][] = [
    ["Realized", lot.realized_nrv_usd, styles.realized!],
    ["Predicted when decided", lot.predicted_nrv_usd, styles.predicted!],
    ["Doing nothing, re-scored with what happened", lot.default_nrv_usd, styles.default!],
  ];
  const max = Math.max(...rows.map((r) => r[1] ?? 0), 1);
  return (
    <div className={styles.compare} data-testid={`outcome-${lot.lot_id}`}>
      {rows.map(([label, v, cls]) => (
        <div key={label} className={styles.bar}>
          <span className={styles.barLabel}>{label}</span>
          <span className={styles.track}>
            <span className={`${styles.fill} ${cls}`} style={{ width: `${((v ?? 0) / max) * 100}%` }} />
          </span>
          <span className={`num ${styles.barValue}`}>{usd(v)}</span>
        </div>
      ))}
    </div>
  );
}

function ClaimTrack({ c }: { c: Claim }) {
  const at = CLAIM_PATH.indexOf(c.status);
  return (
    <div className={styles.claim} data-testid={`claim-${c.claim_id}`}>
      <p>
        <span className="id">{c.claim_id}</span> against {partyName(c.counterparty_party_id)} for {humanizeCode(c.basis).toLowerCase()}
        {c.amount_usd !== null && <>, claimed <strong className="num">{usd(c.amount_usd)}</strong></>}
        {c.paid_usd !== null && <>, paid <strong className="num">{usd(c.paid_usd)}</strong></>}
      </p>
      <ol className={styles.claimPath}>
        {(at >= 0 ? CLAIM_PATH : [...CLAIM_PATH.slice(0, 3), c.status]).map((s, i) => (
          <li key={s} className={i <= Math.max(at, 0) || s === c.status ? styles.reached : undefined}>
            {humanizeCode(s)}
          </li>
        ))}
      </ol>
      <p className="faint">
        Notice {utc(c.notice_sent_at)}, filed {utc(c.filed_at)}, filing due {utc(c.filing_due_at)}
      </p>
    </div>
  );
}

export function OutcomePanel() {
  const { view } = useCockpit();
  const { lots, claims } = view.outcome;
  return (
    <>
      <PanelTitle title="Outcome" lead="What actually happened, against what was predicted and against doing nothing. Snowflake computes every figure here." />
      <Section title="Lots" id="outcome-lots">
        {!lots.length && <NotYet>The outcome is recorded when the receipt inspection arrives.</NotYet>}
        {lots.map((l) => (
          <div key={l.lot_id} className={styles.lot}>
            <h4>
              <span className="id">{l.lot_id}</span> {l.accepted_at_receipt === true ? "accepted at receipt" : l.accepted_at_receipt === false ? "rejected at receipt" : ""}
              <span className={`${panel.pill} ${l.outcome_status === "OBSERVED" ? panel.good : panel.warn}`}>{l.outcome_status.toLowerCase()}</span>
            </h4>
            <Compare lot={l} />
            <KV
              items={[
                ["Value protected vs doing nothing (after the fact)", <strong key="v" className="num">{usdSigned(l.value_protected_expost_usd)}</strong>],
                ["Shelf-life prediction error", <span key="e" className="num">{l.sl_prediction_error_days === null ? "–" : `${l.sl_prediction_error_days > 0 ? "+" : ""}${l.sl_prediction_error_days} days`}</span>],
                ["Computed", utc(l.computed_at)],
              ]}
            />
            <details className={styles.observed}>
              <summary>What was observed</summary>
              <Value value={l.observed} />
            </details>
          </div>
        ))}
      </Section>
      <Section title="Claims" id="claims">
        {claims.length ? claims.map((c) => <ClaimTrack key={c.claim_id} c={c} />) : <NotYet>No claim has been opened.</NotYet>}
      </Section>
    </>
  );
}
