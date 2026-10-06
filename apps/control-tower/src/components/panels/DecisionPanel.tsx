"use client";

import { DeciderBadge } from "@/components/common/bits";
import { useCockpit } from "@/components/cockpit/context";
import { escalationText } from "@/console/templates";
import { utc } from "@/domain/format";
import { AgentRuns, agentName } from "./AgentRuns";
import { BriefView } from "./BriefView";
import { AgentText, KV, NotYet, PanelTitle, Section, panel } from "./ui";

export function DecisionPanel() {
  const { view, now, openEvidence } = useCockpit();
  const recs = view.decision.recommendations;
  const rec = recs.find((r) => r.status === "ACTIVE") ?? recs.at(-1);
  const labelOf = (id: string) => view.options.find((o) => o.option_id === id)?.label ?? id;
  const strategistRunning = view.agents.runs.some((r) => (r.agent === "RECOVERY_STRATEGIST" || r.agent === "CLAIMS_RECOVERY") && r.status === "STARTED");

  if (!rec) {
    return (
      <>
        <PanelTitle title="Decision" />
        {strategistRunning ? (
          <p className={panel.note}>No option dominates, so an agent is weighing them. Its live trace is below; every number it may use comes from the engine.</p>
        ) : (
          <NotYet>The recommendation comes after the options are scored.</NotYet>
        )}
        <AgentRuns runs={view.agents.runs} caseId={view.case.case_id} onCite={openEvidence} agents={["RECOVERY_STRATEGIST", "CLAIMS_RECOVERY"]} />
      </>
    );
  }
  const submission = rec.submission;
  return (
    <>
      <PanelTitle
        title="Decision"
        lead="The Decision Brief: six questions, answered from the sealed evidence and the scored options. Approvals bind to its hash."
      >
        <DeciderBadge kind={rec.decided_by} id={rec.decider_id} audit={rec.audit_status} />
      </PanelTitle>
      <Section title="Recommendation" id="recommendation" aside={`${rec.rec_id}, recorded ${utc(rec.created_at, now)}`}>
        <KV
          items={[
            ["Option", labelOf(rec.option_id)],
            ["Brief hash", <span key="h" className={panel.hash} data-testid="brief-hash">{rec.brief_hash ?? "–"}</span>],
            ["Why it went to an agent", rec.escalation_reasons.length ? rec.escalation_reasons.map(escalationText).join(" ") : "It didn't: a rule decided."],
            ["Audit", rec.audit_status === "NOT_REQUIRED" ? "Not required: no AI-written text" : rec.audit_status.toLowerCase()],
          ]}
        />
      </Section>
      {rec.brief && (
        <Section title="Decision Brief" id="brief">
          <BriefView rec={rec} brief={rec.brief} labelOf={labelOf} onCite={openEvidence} />
        </Section>
      )}
      {submission && "trade_off" in submission && (
        <Section title="The agent's reasoning" id="agent-reasoning" aside="Validated on submission: citations exist, numbers match the scored set">
          <AgentText author={agentName(rec.decider_id.split("@")[0] ?? "")} audit={rec.audit_status}>
            <KV
              items={[
                ["Trade-off", submission.trade_off],
                ["Would change if", submission.would_change_if],
                ["Why not the top score", submission.deviation_reason || "It is the top score."],
                ["Confidence", `${submission.confidence.toLowerCase()}: ${submission.confidence_reasons.join("; ")}`],
              ]}
            />
            <ul>
              {submission.rejected_alternatives.map((r) => (
                <li key={r.option_id}>
                  Not {labelOf(r.option_id)}: {r.reason}
                </li>
              ))}
            </ul>
          </AgentText>
        </Section>
      )}
      {submission && "letter_draft" in submission && (
        <Section title="The claim position" id="claim-position">
          <AgentText author={agentName("CLAIMS_RECOVERY")} audit={rec.audit_status}>
            <KV
              items={[
                ["Action", submission.action.replaceAll("_", " ").toLowerCase()],
                ["Counterparty", submission.counterparty_id],
                ["Prerequisites met", submission.prerequisites_ack.map((p) => p.replaceAll("_", " ").toLowerCase()).join(", ") || "none"],
              ]}
            />
            {submission.anticipated_defenses.map((d) => (
              <p key={d.defense}>
                Against {d.defense.replaceAll("_", " ").toLowerCase()}: {d.rebuttal}
              </p>
            ))}
            {submission.letter_draft && <blockquote>{submission.letter_draft}</blockquote>}
          </AgentText>
        </Section>
      )}
      {recs.length > 1 && (
        <Section title="Earlier recommendations" id="earlier">
          <ul>
            {recs.filter((r) => r !== rec).map((r) => (
              <li key={r.rec_id}>
                <span className="id">{r.rec_id}</span> {labelOf(r.option_id)}, {r.status.toLowerCase()}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <AgentRuns runs={view.agents.runs} caseId={view.case.case_id} onCite={openEvidence} agents={["RECOVERY_STRATEGIST", "CLAIMS_RECOVERY", "EVIDENCE_AUDITOR"]} />
    </>
  );
}
