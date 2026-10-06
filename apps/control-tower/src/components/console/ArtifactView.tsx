"use client";

import { Countdown, DeciderBadge, RoleChip } from "@/components/common/bits";
import { Value } from "@/components/common/Value";
import { AgentRun } from "@/components/panels/AgentRuns";
import { BriefView } from "@/components/panels/BriefView";
import { LedgerTable } from "@/components/panels/LedgerTable";
import { MutationCard } from "@/components/panels/MutationCard";
import { NrvParts, OptionTable, bundleText } from "@/components/panels/OptionParts";
import { ExportResultView, ReplayResultView, VerifyResult } from "@/components/panels/ProofResult";
import { useCockpitMaybe } from "./useCockpitMaybe";
import type { ExportResult, ReplayResult, VerifyLedgerResult } from "@blueberrychain/bbc-api";
import type { Artifact } from "@/console/artifacts";
import { humanizeCode } from "@/console/templates";
import { usd, usdSigned, utc } from "@/domain/format";
import styles from "./console.module.css";

/** Render one console artifact. Every value comes from the governed view or a Snowflake result. */
export function ArtifactView({ artifact: a, onRun }: { artifact: Artifact; onRun: (input: string) => void }) {
  const cockpit = useCockpitMaybe();
  const cite = (id: string) => (cockpit ? cockpit.openEvidence(id) : onRun(`evidence ${id}`));
  const now = cockpit?.now ?? Date.now();
  const labelOf = (id: string) => cockpit?.view.options.find((o) => o.option_id === id)?.label ?? id;

  switch (a.type) {
    case "status":
      return (
        <div className={styles.art} data-testid="artifact-status">
          <p>
            <strong>{a.stage}:</strong> {a.state_text} {a.decision_point === "D2" && <span className="faint">(settlement)</span>}
          </p>
          <div className={styles.row}>
            <Countdown deadline={a.deadline_ts} now={now} label="Decision deadline" />
            {a.fallback && <span className={styles.warnText}>Fallback {a.fallback.label} at {utc(a.fallback.runs_at, now)}</span>}
            <span>Value at risk <strong className="num">{usd(a.value_at_risk_usd)}</strong></span>
          </div>
          {a.recommendation && (
            <p>
              Recommended: {a.recommendation.label ?? a.recommendation.option_id} <DeciderBadge kind={a.recommendation.decided_by} id={a.recommendation.decider_id} audit={a.recommendation.audit_status} />
            </p>
          )}
          {a.awaiting_roles.length > 0 && <p>Waiting for {a.awaiting_roles.map((r) => <RoleChip key={r} role={r} />)}</p>}
          <ul className={styles.actions}>
            {a.my_actions.map((m) => (
              <li key={m.text} className={m.enabled ? styles.can : styles.cannot}>
                {m.enabled ? "You can: " : "You can't: "}
                {m.text}
              </li>
            ))}
          </ul>
        </div>
      );
    case "brief":
      return (
        <div className={styles.art}>
          <BriefView rec={a} brief={a.brief} labelOf={labelOf} onCite={cite} question={a.question} />
        </div>
      );
    case "option":
      return (
        <div className={styles.art} data-testid="artifact-option">
          <p>
            <strong>{a.option.label}</strong> <span className="id faint">{a.option.option_id}</span>{" "}
            {a.recommended ? "is the recommendation." : a.is_do_nothing ? "is doing nothing (always scored)." : a.option.feasible ? `ranks ${a.option.score.rank}.` : "was ruled out."}
          </p>
          {a.eliminated.length ? (
            <ul>{a.eliminated.map((e) => <li key={e.code}>{e.text} <span className="muted">{e.detail}</span></li>)}</ul>
          ) : (
            <>
              <ul>{bundleText(a.option).map((l) => <li key={l}>{l}</li>)}</ul>
              <NrvParts o={a.option} />
            </>
          )}
          {a.agent_reason && <p className={styles.agentReason}>The Strategist's reason (AI-written): {a.agent_reason}</p>}
        </div>
      );
    case "compare":
      return (
        <div className={styles.art}>
          <OptionTable options={a.options} recommendedId={a.recommended_id} onCite={cite} />
        </div>
      );
    case "evidence":
      return (
        <div className={styles.art}>
          {a.found ? (
            <>
              <p>
                {a.label} at <span className="id">{a.pointer}</span>
              </p>
              <Value value={a.value} />
            </>
          ) : (
            <p className="muted">{a.evidence_id} isn't in this case view; the tool that minted it returned it to an agent run.</p>
          )}
        </div>
      );
    case "trace":
      return (
        <div className={styles.art}>
          <AgentRun run={a.run} caseId={cockpit?.view.case.case_id ?? ""} onCite={cite} />
        </div>
      );
    case "ledger":
      return (
        <div className={styles.art}>
          <p className="faint">Last {a.entries.length} of {a.total} entries</p>
          <LedgerTable entries={a.entries} chain />
        </div>
      );
    case "mutation":
      return (
        <div className={styles.art}>
          {a.mutations.map((m) => <MutationCard key={m.mutation_id} m={m} />)}
        </div>
      );
    case "outcome":
      return (
        <div className={styles.art}>
          {a.lots.length ? (
            a.lots.map((l) => (
              <p key={l.lot_id}>
                <span className="id">{l.lot_id}</span>: realized <strong className="num">{usd(l.realized_nrv_usd)}</strong>, predicted {usd(l.predicted_nrv_usd)}, doing nothing {usd(l.default_nrv_usd)};{" "}
                {usdSigned(l.value_protected_expost_usd)} protected after the fact.
              </p>
            ))
          ) : (
            <p className="muted">No outcome yet.</p>
          )}
          {a.claims.map((c) => (
            <p key={c.claim_id}>
              Claim <span className="id">{c.claim_id}</span> {humanizeCode(c.status).toLowerCase()}
              {c.amount_usd !== null && `, ${usd(c.amount_usd)} claimed`}
              {c.paid_usd !== null && `, ${usd(c.paid_usd)} paid`}.
            </p>
          ))}
        </div>
      );
    case "policy":
      return (
        <div className={styles.art}>
          <p>
            Policy v{a.policy.policy_version}. Dispatch {a.policy.kill_switches.dispatch_enabled ? "enabled" : "stopped"}, shadow mode {a.policy.kill_switches.shadow_mode ? "on" : "off"}, autonomy ceiling L
            {a.policy.kill_switches.autonomy_ceiling}.
          </p>
          {a.evaluation && (
            <p>
              Evaluated {humanizeCode(a.evaluation.outcome).toLowerCase()} at L{a.evaluation.autonomy_level}: {a.evaluation.reasons.join(" ")}
            </p>
          )}
        </div>
      );
    case "approvals":
      return (
        <div className={styles.art}>
          <ul>
            {a.approvals.map((p) => (
              <li key={p.approval_id}>
                <RoleChip role={p.required_role} /> <span className="id">{p.approval_id}</span> {humanizeCode(p.status).toLowerCase()}
                {p.decided_by && ` by ${p.decided_by}`}, due {utc(p.due_at, now)}
              </li>
            ))}
          </ul>
          <ul className={styles.actions}>
            {a.my_actions.map((m) => <li key={m.text} className={m.enabled ? styles.can : styles.cannot}>{m.text}</li>)}
          </ul>
        </div>
      );
    case "help":
      return (
        <div className={styles.art}>
          <table className={styles.help}>
            <tbody>
              {a.commands.map((c) => (
                <tr key={c.usage}>
                  <td className={styles.group}>{c.group}</td>
                  <td><code>{c.usage}</code></td>
                  <td>{c.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "proof": {
      // Refusals arrive as error artifacts; VERIFY_LEDGER (a SQL procedure) answers without a status.
      const r = a.result as unknown as Record<string, unknown>;
      if (r["status"] === "INVALID" || r["status"] === "DENIED") return null;
      return (
        <div className={styles.art}>
          {a.call === "VERIFY_LEDGER" && "ok" in r && <VerifyResult r={a.result as VerifyLedgerResult} />}
          {a.call === "REPLAY_EVIDENCE" && "equal" in r && <ReplayResultView r={a.result as Extract<ReplayResult, { status: "OK" }>} />}
          {a.call === "EXPORT_EVIDENCE_PACK" && "url" in r && <ExportResultView r={a.result as Extract<ExportResult, { status: "OK" }>} />}
        </div>
      );
    }
    case "analyst":
      return (
        <div className={`${styles.art} ${styles.analyst}`} data-testid="artifact-analyst">
          <p className={styles.analystHead}>
            Cortex Analyst over <span className="id">{a.answer.semantic_view}</span>. A metric answer, not decision evidence.
            {a.recorded && " Recorded answer."}
          </p>
          {a.answer.interpretation && <p className={styles.interp}>Analyst read the question as: {a.answer.interpretation}</p>}
          {a.answer.sql && <pre className={styles.sql}>{a.answer.sql}</pre>}
          {a.answer.columns.length > 0 && (
            <table className={styles.result}>
              <thead>
                <tr>{a.answer.columns.map((c) => <th key={c.name} scope="col">{c.name.toLowerCase().replaceAll("_", " ")}</th>)}</tr>
              </thead>
              <tbody>
                {a.answer.rows.map((r, i) => (
                  <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === "number" ? "num" : undefined}>{v === null ? "–" : String(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="faint">
            {a.answer.row_count} row(s){a.answer.truncated ? ", truncated" : ""}
            {a.answer.executed_as && `, run as ${a.answer.executed_as.user} (${a.answer.executed_as.role})`}.
          </p>
          {a.answer.warnings.map((w) => <p key={w} className={styles.warnText}>{w}</p>)}
          {a.answer.suggestions.length > 0 && (
            <p>
              Try:{" "}
              {a.answer.suggestions.map((s) => (
                <button key={s} type="button" className={styles.suggest} onClick={() => onRun(`? ${s}`)}>
                  {s}
                </button>
              ))}
            </p>
          )}
        </div>
      );
    case "analyst_miss":
      return (
        <div className={styles.art}>
          <p className="muted">Fixture mode has no recorded answer for that question. Recorded questions:</p>
          <ul>
            {a.recorded_questions.map((q) => (
              <li key={q}>
                <button type="button" className={styles.suggest} onClick={() => onRun(`? ${q}`)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    case "receipt":
      return (
        <div className={`${styles.art} ${styles.receipt}`} data-testid="artifact-receipt">
          <p>{a.summary}</p>
        </div>
      );
    case "confirm":
      return null;
    case "error":
      return (
        <div className={`${styles.art} ${styles.error}`} role="alert" data-testid="artifact-error" data-code={a.code ?? ""}>
          <p>
            {a.code && <span className={styles.code}>{a.code.toLowerCase().replaceAll("_", " ")}</span>} {a.message}
          </p>
          {a.suggestions.length > 0 && (
            <p>
              Did you mean{" "}
              {a.suggestions.map((s) => (
                <button key={s} type="button" className={styles.suggest} onClick={() => onRun(s)}>
                  {s}
                </button>
              ))}
            </p>
          )}
        </div>
      );
    default:
      return null;
  }
}
