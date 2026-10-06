"use client";

import type { CaseView } from "@blueberrychain/bbc-api";
import { Cite, DeciderBadge } from "@/components/common/bits";
import { BRIEF_QUESTIONS, DECIDER_TEXT, eliminationText, escalationText, humanizeCode } from "@/console/templates";
import { days, prob, usd, usdSigned, utc } from "@/domain/format";
import { agentName } from "./AgentRuns";
import { AgentText, panel } from "./ui";
import styles from "./BriefView.module.css";

type Rec = CaseView["decision"]["recommendations"][number];
type Brief = NonNullable<Rec["brief"]>;
type Verdict = NonNullable<Rec["audit_verdict"]>;

/** The AI-written text with each audited statement marked by the auditor's verdict. */
export function AuditSpans({ text, verdict, onCite }: { text: string; verdict: Verdict; onCite: (id: string) => void }) {
  const chars = Array.from(text);
  const statements = [...verdict.statements].sort((a, b) => a.span.start - b.span.start);
  const parts: { text: string; s: Verdict["statements"][number] | null }[] = [];
  let at = 0;
  for (const s of statements) {
    if (s.span.start > at) parts.push({ text: chars.slice(at, s.span.start).join(""), s: null });
    parts.push({ text: chars.slice(Math.max(at, s.span.start), s.span.end).join(""), s });
    at = Math.max(at, s.span.end);
  }
  if (at < chars.length) parts.push({ text: chars.slice(at).join(""), s: null });
  return (
    <div data-testid="audit-spans">
      <p className={styles.spans}>
        {parts.map((p, i) =>
          p.s ? (
            <mark key={i} className={styles[`v${p.s.verdict}`]} title={`${p.s.verdict.toLowerCase()}: ${p.s.evidence_ids.join(", ")}`} data-verdict={p.s.verdict}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      <ol className={styles.statements}>
        {statements.map((s) => (
          <li key={s.span.start}>
            <span className={`${panel.pill} ${s.verdict === "SUPPORTED" ? panel.good : panel.bad}`}>{s.verdict.toLowerCase()}</span> {s.statement}
            {s.evidence_ids.map((id) => <Cite key={id} id={id} onOpen={onCite} />)}
          </li>
        ))}
      </ol>
      {verdict.required_fixes.length > 0 && <p className={styles.fixes}>Required fixes: {verdict.required_fixes.join("; ")}</p>}
      <p className={styles.overall}>
        Overall: <strong>{verdict.overall === "PASS" ? "passed" : "failed"}</strong>
      </p>
    </div>
  );
}

function Q({ n, show, children }: { n: number; show: number | null; children: React.ReactNode }) {
  if (show !== null && show !== n) return null;
  return (
    <section className={styles.q} data-testid={`brief-q${n}`}>
      <h4>
        <span className={`${styles.qn} num`}>{n}</span>
        {BRIEF_QUESTIONS[n - 1]}
      </h4>
      <div className={styles.qBody}>{children}</div>
    </section>
  );
}

export function BriefView({ rec, brief, labelOf, onCite, question = null }: { rec: Pick<Rec, "decided_by" | "decider_id" | "audit_status" | "audit_verdict" | "audited_text" | "run_id">; brief: Brief; labelOf: (id: string) => string; onCite: (id: string) => void; question?: number | null }) {
  const dn = brief.do_nothing.outcome;
  return (
    <div className={styles.brief} data-testid="decision-brief">
      <Q n={1} show={question}>
        <p>
          <strong className="num">{usd(dn.financial.expected_nrv_usd)}</strong> expected net value ({usd(dn.financial.nrv_p10_usd)} to {usd(dn.financial.nrv_p90_usd)}), with a{" "}
          {prob(dn.operational.p_accept)} chance the customer accepts it, {days(dn.operational.sl_at_arrival_days_p50)} of shelf life on arrival, and{" "}
          {usd(dn.financial.expected_loss_usd)} expected loss against plan.
        </p>
        <p className="muted">{labelOf(brief.do_nothing.option_id)}</p>
      </Q>
      <Q n={2} show={question}>
        <ul className={styles.list}>
          {brief.options.map((o) => (
            <li key={o.option_id}>
              {o.label} <span className="id faint">{o.option_id}</span>, available until {utc(o.expires_at)}
              {o.flags.map((f) => <span key={f} className={`${panel.pill} ${panel.warn}`}> {humanizeCode(f).toLowerCase()}</span>)}
            </li>
          ))}
        </ul>
      </Q>
      <Q n={3} show={question}>
        <table className={panel.table}>
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col" className={panel.r}>Expected</th>
              <th scope="col" className={panel.r}>P10</th>
              <th scope="col" className={panel.r}>P90</th>
              <th scope="col" className={panel.r}>vs do nothing</th>
            </tr>
          </thead>
          <tbody>
            {brief.value_table.map((v) => (
              <tr key={v.option_id} className={v.option_id === brief.recommendation.option_id ? panel.emph : v.option_id === brief.do_nothing.option_id ? panel.base : undefined}>
                <td>{labelOf(v.option_id)}</td>
                <td className={`${panel.r} num`}>{usd(v.expected_nrv_usd)}</td>
                <td className={`${panel.r} num`}>{usd(v.nrv_p10_usd)}</td>
                <td className={`${panel.r} num`}>{usd(v.nrv_p90_usd)}</td>
                <td className={`${panel.r} num`}>{usdSigned(v.value_preserved_vs_default_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Q>
      <Q n={4} show={question}>
        {brief.eliminated.length ? (
          <ul className={styles.list}>
            {brief.eliminated.map((e) => (
              <li key={e.option_id}>
                <strong>{e.label}</strong>:{" "}
                {e.reasons.map((r) => (
                  <span key={r.code}>
                    {eliminationText(r.code)} <span className="muted">{r.detail}</span>
                    {r.evidence_id && <Cite id={r.evidence_id} onOpen={onCite} />}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing was ruled out.</p>
        )}
      </Q>
      <Q n={5} show={question}>
        <p>
          The top two options are <strong className="num">{usd(brief.comparison.margin_top2_usd)}</strong> apart. Options no other option beats on every measure:{" "}
          {brief.comparison.non_dominated.map(labelOf).join("; ")}.
        </p>
        {brief.comparison.escalation_reasons.length ? (
          <ul className={styles.list}>
            {brief.comparison.escalation_reasons.map((r) => <li key={r}>{escalationText(r)}</li>)}
          </ul>
        ) : (
          <p className="muted">No escalation trigger fired, so a rule could decide.</p>
        )}
        {brief.precedents.length > 0 && (
          <>
            <h5 className={styles.h5}>Similar sealed cases</h5>
            <ul className={styles.list}>
              {brief.precedents.map((p) => (
                <li key={p.case_id}>
                  <span className="id">{p.case_id}</span> ({Math.round(p.similarity * 100)}% similar): {humanizeCode(p.action_kind).toLowerCase()} by {p.decider_kind.toLowerCase()}
                  {p.value_protected_expost_usd !== undefined && p.value_protected_expost_usd !== null && <>, {usdSigned(p.value_protected_expost_usd)} protected</>}
                  <Cite id={p.evidence_id} onOpen={onCite} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Q>
      <Q n={6} show={question}>
        <div className={styles.recHead}>
          <strong>{labelOf(brief.recommendation.option_id)}</strong>
          <DeciderBadge kind={rec.decided_by} id={rec.decider_id} audit={rec.audit_status} />
        </div>
        <p className="muted">{DECIDER_TEXT[rec.decided_by]}</p>
        <ul className={styles.why}>
          {brief.recommendation.why_structured.map((w) => <li key={w}>{humanizeCode(w)}</li>)}
        </ul>
        {rec.decided_by === "AGENT" ? (
          <AgentText author={agentName(rec.decider_id.split("@")[0] ?? rec.decider_id)} audit={rec.audit_status}>
            {rec.audit_verdict && rec.audited_text ? <AuditSpans text={rec.audited_text} verdict={rec.audit_verdict} onCite={onCite} /> : <p>{brief.recommendation.narrative}</p>}
          </AgentText>
        ) : (
          <p className={styles.template}>{brief.recommendation.narrative}</p>
        )}
      </Q>
    </div>
  );
}
