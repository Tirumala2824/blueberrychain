"use client";

import { useState } from "react";
import type { AvailableAction } from "@blueberrychain/bbc-api";
import { Countdown, RoleChip } from "@/components/common/bits";
import { useCockpit } from "@/components/cockpit/context";
import { humanizeCode } from "@/console/templates";
import { roleName, utc } from "@/domain/format";
import { KV, NotYet, PanelTitle, Section, panel } from "./ui";
import styles from "./ApprovalPanel.module.css";

const OUTCOME_TEXT: Record<string, string> = {
  AUTO: "Policy lets this run without approval.",
  APPROVE: "Policy requires approval before anything is executed.",
  HUMAN_INITIATE: "Policy lets the engine recommend only: a person must initiate it.",
  OBSERVE_ONLY: "Policy allows observation only: nothing will execute except the safe fallback.",
  DENY: "Policy denies this action.",
};

const quote = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

function DecisionForm({ action }: { action: AvailableAction }) {
  const { run, view } = useCockpit();
  const [mode, setMode] = useState<"idle" | "choose" | "reject">("idle");
  const [reason, setReason] = useState("");
  const [option, setOption] = useState(action.choosable_option_ids?.[0] ?? "");
  const id = action.approval_id!;
  const labelOf = (o: string) => view.options.find((x) => x.option_id === o)?.label ?? o;
  const needsReason = (v: "APPROVE" | "ALTERNATIVE" | "REJECT") => action.reason_required_for?.includes(v) ?? false;
  const verdict = mode === "reject" ? "REJECT" : mode === "choose" ? "ALTERNATIVE" : "APPROVE";
  const missingReason = needsReason(verdict) && !reason.trim();
  return (
    <div className={styles.form} data-testid={`decide-${id}`}>
      <div className={panel.actions}>
        {action.verdicts?.includes("APPROVE") && (
          <button
            type="button"
            className={panel.btn}
            disabled={mode === "idle" && missingReason}
            onClick={() => run(reason.trim() ? `approve ${id} reason ${quote(reason.trim())}` : `approve ${id}`)}
            data-testid="approve-button"
          >
            Approve
          </button>
        )}
        {action.verdicts?.includes("ALTERNATIVE") && !!action.choosable_option_ids?.length && (
          <button type="button" className={panel.btnQuiet} aria-expanded={mode === "choose"} onClick={() => setMode(mode === "choose" ? "idle" : "choose")}>
            Choose another option
          </button>
        )}
        {action.verdicts?.includes("REJECT") && (
          <button type="button" className={panel.btnDanger} aria-expanded={mode === "reject"} onClick={() => setMode(mode === "reject" ? "idle" : "reject")}>
            Reject
          </button>
        )}
      </div>
      {mode === "choose" && (
        <label className={panel.field}>
          Option to approve instead
          <select value={option} onChange={(e) => setOption(e.target.value)}>
            {action.choosable_option_ids!.map((o) => (
              <option key={o} value={o}>
                {labelOf(o)} ({o})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={panel.field}>
        Reason {needsReason(verdict) ? "(required: Snowflake records it with your decision)" : "(optional)"}
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-testid="decision-reason" />
      </label>
      {mode !== "idle" && (
        <div className={panel.actions}>
          <button
            type="button"
            className={mode === "reject" ? panel.btnDanger : panel.btn}
            disabled={missingReason}
            onClick={() => run(mode === "reject" ? `reject ${id} reason ${quote(reason.trim())}` : `choose ${option} ${id} reason ${quote(reason.trim())}`)}
          >
            {mode === "reject" ? "Review rejection" : "Review choice"}
          </button>
          <span className={panel.note}>You'll see exactly what will be sent to Snowflake before anything happens.</span>
        </div>
      )}
    </div>
  );
}

export function ApprovalPanel() {
  const { view, now } = useCockpit();
  const evaluation = view.governance.evaluations.at(-1);
  const approvals = view.governance.approvals;
  const mine = view.viewer.available_actions.filter((a) => a.action === "DECIDE_APPROVAL");
  const ks = view.governance.policy.kill_switches;
  if (!evaluation) {
    return (
      <>
        <PanelTitle title="Approval" />
        <NotYet>Policy is evaluated once a recommendation is recorded (and, if an AI wrote it, audited).</NotYet>
      </>
    );
  }
  return (
    <>
      <PanelTitle title="Approval" lead="Who must agree, decided by the active policy in Snowflake. Snowflake checks your identity, role and the Brief's freshness when you decide." />
      <Section title="Your decision" id="your-decision" aside={`Signed in as ${view.viewer.user} (${view.viewer.role})`}>
        {mine.filter((a) => a.enabled).map((a) => (
          <div key={a.approval_id} className={styles.mine}>
            <p>
              <RoleChip role={a.required_role ?? ""} mine /> <span className="id">{a.approval_id}</span> is yours to decide.
              {a.due_at && <> Due <Countdown deadline={a.due_at} now={now} />.</>}
            </p>
            <DecisionForm action={a} />
          </div>
        ))}
        {mine.filter((a) => !a.enabled).map((a) => (
          <p key={a.approval_id} className={styles.cannot} data-testid={`cannot-${a.approval_id}`}>
            <span className="id">{a.approval_id}</span>: {a.disabled_reason}
          </p>
        ))}
        {!mine.length && <p className={panel.note}>There is nothing for {roleName(view.viewer.role)} to decide on this case.</p>}
        {view.governance.fallback && (
          <p className={styles.fallback}>
            If nothing has executed by {utc(view.governance.fallback.runs_at, now)}, Snowflake's deadline watchdog runs the safe fallback: {view.governance.fallback.label}.
            It doesn't need this page, the engine or any approver to be running.
          </p>
        )}
      </Section>
      <Section title="Approvals" id="approvals" aside={evaluation.dual_approval ? "Dual approval: two different people with two different roles" : undefined}>
        <table className={panel.table} data-testid="approvals-table">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Due</th>
              <th scope="col">Decided by</th>
              <th scope="col">Evidence still fresh</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.approval_id} data-approval-id={a.approval_id}>
                <td>
                  <RoleChip role={a.required_role} />
                  <div className="id faint">{a.approval_id}</div>
                </td>
                <td>
                  <span className={`${panel.pill} ${a.status === "APPROVED" ? panel.good : a.status === "REQUESTED" ? panel.info : panel.bad}`} data-status={a.status}>
                    {humanizeCode(a.status).toLowerCase()}
                  </span>
                </td>
                <td>{a.status === "REQUESTED" ? <Countdown deadline={a.due_at} now={now} /> : <span className="num">{utc(a.due_at, now)}</span>}</td>
                <td>{a.decided_by ? <>{a.decided_by} <span className="faint">{a.decided_role}</span><div className="num faint">{utc(a.decided_at, now)}</div></> : <span className="faint">–</span>}</td>
                <td>
                  {a.freshness ? (
                    <span className={`${panel.pill} ${a.freshness.brief_fresh && a.freshness.pack_fresh ? panel.good : panel.bad}`}>
                      {a.freshness.brief_fresh && a.freshness.pack_fresh ? "fresh" : "stale: decide again"}
                    </span>
                  ) : "–"}
                </td>
                <td>{a.reason ?? <span className="faint">–</span>}{a.chosen_option_id && <div>Chose <span className="id">{a.chosen_option_id}</span></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="How policy evaluated it" id="evaluation" aside={`Policy v${evaluation.policy_version}, ${evaluation.eval_id}`}>
        <p className={styles.outcome}>{OUTCOME_TEXT[evaluation.outcome] ?? evaluation.outcome}</p>
        <KV
          items={[
            ["Autonomy level", `L${evaluation.autonomy_level}`],
            ["Required roles", evaluation.required_roles.map(roleName).join(" and ") || "none"],
            ["Matched rules", evaluation.matched_rules.join(", ") || "none"],
            ["Shadow mode", evaluation.shadow ? "on: recorded, nothing dispatched" : "off"],
            ["Dispatch", ks.dispatch_enabled ? "enabled" : "stopped"],
            ["Autonomy ceiling", `L${ks.autonomy_ceiling}`],
          ]}
        />
        {evaluation.reasons.length > 0 && (
          <ul className={styles.reasons}>
            {evaluation.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <table className={panel.table}>
          <thead>
            <tr>
              <th scope="col">Dimension</th>
              <th scope="col">Measure</th>
              <th scope="col" className={panel.r}>Value</th>
              <th scope="col">Level</th>
              <th scope="col">Approver</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.dimensions.map((d) => (
              <tr key={`${d.dimension}-${d.metric}`}>
                <td>{humanizeCode(d.dimension)}</td>
                <td>{humanizeCode(d.metric)}</td>
                <td className={`${panel.r} num`}>{String(d.value)}</td>
                <td><span className={`${panel.pill} ${d.band === "L3" ? panel.good : d.band === "L4" ? panel.info : panel.warn}`}>{humanizeCode(d.band)}</span></td>
                <td>{d.approver_roles.map(roleName).join(", ") || <span className="faint">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}
