"use client";

import { Countdown, RoleChip } from "@/components/common/bits";
import { stateText } from "@/console/templates";
import { partyName, usd, utc } from "@/domain/format";
import { useCockpit } from "./context";
import styles from "./CaseHeader.module.css";

export function CaseHeader() {
  const { view, now } = useCockpit();
  const c = view.case;
  const open = view.governance.approvals.filter((a) => a.status === "REQUESTED");
  const due = open.map((a) => a.due_at).sort()[0] ?? null;
  const mine = new Set(view.viewer.available_actions.filter((a) => a.action === "DECIDE_APPROVAL" && a.enabled).map((a) => a.required_role));
  const ks = view.governance.policy.kill_switches;

  return (
    <header className={styles.header}>
      {!ks.dispatch_enabled && (
        <p className={styles.stopped} role="alert">
          Dispatch is stopped by an emergency stop. Nothing is being sent to SAP, the TMS, carriers or customers.
        </p>
      )}
      <div className={styles.row}>
        <div className={styles.ident}>
          <h1 className="id" data-testid="case-id">{c.case_id}</h1>
          <p className={styles.sub}>
            {c.lots.map((l) => l.lot_id).join(", ")}
            {c.shipment_id && <> on <span className="id">{c.shipment_id}</span></>}
            {c.holder_party_id_at_onset && <>, held by {partyName(c.holder_party_id_at_onset)} when it started</>}
          </p>
        </div>
        <div className={styles.state}>
          <span className={styles.dp}>{c.decision_point === "D1" ? "D1 recovery" : "D2 settlement"}</span>
          <span className={styles.stateText} data-testid="case-state" data-state={c.state}>{stateText(c.state)}</span>
          {open.length > 0 && (
            <span className={styles.waiting}>
              Waiting for {open.map((a) => <RoleChip key={a.approval_id} role={a.required_role} mine={mine.has(a.required_role)} />)}
            </span>
          )}
        </div>
        <div className={styles.clocks}>
          <Countdown deadline={due ?? c.deadline_ts} now={now} label={due ? "Approval due" : "Decision deadline"} size="l" />
          {view.governance.fallback && (
            <span className={styles.fallback}>
              Then Snowflake runs the fallback at {utc(view.governance.fallback.runs_at, now)}
            </span>
          )}
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Value at risk</dt>
            <dd className="num">{usd(c.value_at_risk_usd)}</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd className="num">v{view.governance.policy.policy_version}</dd>
          </div>
          <div>
            <dt>Case clock</dt>
            <dd className="num" title="The time this view of the case was generated, advanced since it was fetched">{utc(new Date(now).toISOString())}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
