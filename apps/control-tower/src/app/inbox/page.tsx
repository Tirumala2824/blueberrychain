"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { InboxRow } from "@blueberrychain/bbc-api";
import { useInbox, useViewClock } from "@/client/live";
import { useSession } from "@/client/session";
import { Countdown, DeciderBadge, RoleChip, StageStrip } from "@/components/common/bits";
import { Problem } from "@/components/common/Problem";
import { AppShell } from "@/components/shell/AppShell";
import { stateText } from "@/console/templates";
import { usd, utc } from "@/domain/format";
import styles from "./inbox.module.css";

type Filter = "mine" | "open" | "sealed";

/** Live rows count down on the wall clock; a fixture row on its tape's frozen moment. */
function Rows({ rows, now, role, fixture }: { rows: InboxRow[]; now: number; role: string; fixture: boolean }) {
  const clockOf = (r: InboxRow) => (fixture ? Date.parse(r.updated_at) : now);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Decision deadline</th>
          <th scope="col">Case</th>
          <th scope="col">Where it is</th>
          <th scope="col">Waiting for</th>
          <th scope="col" className={styles.right}>Value at risk</th>
          <th scope="col">Decided by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.case_id} className={r.awaiting_me ? styles.mine : undefined} data-testid={`inbox-row-${r.case_id}`}>
            <td>
              <Countdown deadline={r.due_at ?? r.deadline_ts} now={clockOf(r)} />
              {r.fallback_at && <div className={styles.fallback}>Fallback {utc(r.fallback_at, clockOf(r))}</div>}
            </td>
            <td>
              <Link href={`/cases/${r.case_id}`} className={styles.caseLink}>
                <span className="id">{r.case_id}</span>
              </Link>
              <div className={styles.sub}>
                {r.lot_ids.join(", ")} {r.shipment_id && <>on <span className="id">{r.shipment_id}</span></>}
              </div>
            </td>
            <td>
              <div className={styles.stage}>
                <StageStrip state={r.state} />
                <span className={styles.dp}>{r.decision_point === "D1" ? "Recovery" : "Settlement"}</span>
              </div>
              <div className={styles.sub}>{stateText(r.state)}</div>
            </td>
            <td>
              <div className={styles.roles}>
                {r.awaiting_roles.length ? r.awaiting_roles.map((role2) => <RoleChip key={role2} role={role2} mine={r.awaiting_me && role2 === role} />) : <span className="faint">Nobody</span>}
              </div>
              {r.awaiting_me && <div className={styles.you}>You can decide this</div>}
            </td>
            <td className={`${styles.right} num`}>{usd(r.value_at_risk_usd)}</td>
            <td>{r.decided_by ? <DeciderBadge kind={r.decided_by} /> : <span className="faint">Not yet</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function InboxPage() {
  const { state } = useSession();
  const inbox = useInbox();
  const now = useViewClock(null, 0);
  const [filter, setFilter] = useState<Filter>("open");
  const rows = useMemo(() => {
    const all = inbox.data ?? [];
    if (filter === "mine") return all.filter((r) => r.awaiting_me);
    if (filter === "sealed") return all.filter((r) => !r.is_open);
    return all.filter((r) => r.is_open);
  }, [inbox.data, filter]);
  const mineCount = (inbox.data ?? []).filter((r) => r.awaiting_me).length;
  const role = state?.identity?.role ?? "";

  return (
    <AppShell>
      <div className={styles.head}>
        <h1>Cases</h1>
        <p className="muted">Open excursion cases, most urgent first: Snowflake orders them by decision deadline and value at risk.</p>
      </div>
      <div className={styles.filters} role="tablist" aria-label="Show">
        {([["mine", `Waiting for you (${mineCount})`], ["open", "Open"], ["sealed", "Sealed"]] as const).map(([key, label]) => (
          <button key={key} role="tab" type="button" aria-selected={filter === key} onClick={() => setFilter(key)} className={filter === key ? styles.on : undefined}>
            {label}
          </button>
        ))}
      </div>
      {inbox.error && <Problem error={inbox.error} what="The case inbox" />}
      {inbox.feedError && <p className={styles.feed}>Live updates paused: {inbox.feedError}</p>}
      {inbox.data && (rows.length ? <Rows rows={rows} now={now} role={role} fixture={state?.mode === "fixture"} /> : (
        <p className={styles.empty}>
          {filter === "mine" ? "Nothing is waiting for your decision. Cases appear here when Snowflake requests your role's approval." : "No cases here."}
        </p>
      ))}
    </AppShell>
  );
}
