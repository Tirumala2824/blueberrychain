/**
 * Read commands: artifacts cut from the governed case view. They select and label
 * fields; they never compute a number the read model doesn't already carry.
 */

import { cockpitStageOf, type CaseState } from "@blueberrychain/shared/cockpit";
import type { AvailableAction, CaseView } from "@blueberrychain/bbc-api";
import { findEvidence } from "../domain/evidence";
import { resolveId } from "../domain/ids";
import type { Artifact, ErrorArtifact } from "./artifacts";
import { VERBS, type Command } from "./grammar";
import { STAGE_NAMES, eliminationText, stateText } from "./templates";

const error = (message: string, suggestions: string[] = []): ErrorArtifact => ({ type: "error", message, code: null, suggestions });

export function activeRecommendation(view: CaseView) {
  return view.decision.recommendations.find((r) => r.status === "ACTIVE") ?? null;
}

/** One line per action Snowflake says the viewer has (or doesn't, and why). */
export function actionText(a: AvailableAction): string {
  const subject = a.approval_id ? `${a.approval_id}${a.required_role ? ` (${a.required_role})` : ""}` : "";
  const name = {
    DECIDE_APPROVAL: "Decide approval",
    REVERSE_DECISION: "Reverse the executed decision",
    VERIFY_LEDGER: "Verify the ledger",
    REPLAY_EVIDENCE: "Replay the evidence pack",
    EXPORT_EVIDENCE_PACK: "Export the evidence pack",
    EMERGENCY_STOP: "Emergency stop",
  }[a.action];
  return a.enabled ? `${name} ${subject}`.trim() : `${name} ${subject}: ${a.disabled_reason ?? "not available"}`.trim();
}

/** The help artifact needs no case. */
export function helpArtifact(topic: string | null): Artifact {
  const specs = topic ? VERBS.filter((v) => v.verb === topic) : VERBS;
  if (!specs.length) return error(`There's no command called ${topic}.`);
  return { type: "help", commands: specs.map((v) => ({ usage: v.usage, summary: v.summary, group: v.group })) };
}

export function readArtifact(command: Command, view: CaseView): Artifact {
  if (command.verb === "help") return helpArtifact(command.topic);
  const rec = activeRecommendation(view);
  const optionIds = view.options.map((o) => o.option_id);
  switch (command.verb) {
    case "status": {
      const option = rec ? view.options.find((o) => o.option_id === rec.option_id) ?? null : null;
      return {
        type: "status",
        case_id: view.case.case_id,
        decision_point: view.case.decision_point,
        state: view.case.state,
        stage: STAGE_NAMES[cockpitStageOf(view.case.state as CaseState)] ?? "",
        state_text: stateText(view.case.state),
        deadline_ts: view.case.deadline_ts,
        fallback: view.governance.fallback,
        value_at_risk_usd: view.case.value_at_risk_usd,
        recommendation: rec
          ? { option_id: rec.option_id, label: option?.label ?? null, decided_by: rec.decided_by, decider_id: rec.decider_id, audit_status: rec.audit_status }
          : null,
        awaiting_roles: [...new Set(view.governance.approvals.filter((a) => a.status === "REQUESTED").map((a) => a.required_role))],
        my_actions: view.viewer.available_actions.map((a) => ({ action: a.action, enabled: a.enabled, text: actionText(a) })),
        generated_at: view.generated_at,
      };
    }
    case "brief": {
      if (!rec?.brief) return error("There is no Decision Brief yet: options haven't been recommended on.");
      return {
        type: "brief", question: command.question, brief: rec.brief, decided_by: rec.decided_by, decider_id: rec.decider_id,
        audit_status: rec.audit_status, audit_verdict: rec.audit_verdict, audited_text: rec.audited_text, run_id: rec.run_id,
      };
    }
    case "why": {
      const r = resolveId(command.option, "OPT", optionIds, "option");
      if (!r.ok) return error(r.error, r.candidates);
      const option = view.options.find((o) => o.option_id === r.id)!;
      const submission = rec?.submission;
      const rejected = submission && "rejected_alternatives" in submission ? submission.rejected_alternatives : [];
      return {
        type: "option",
        option,
        recommended: rec?.option_id === option.option_id,
        is_do_nothing: option.is_default,
        eliminated: option.eliminations.map((e) => ({ code: e.code, text: eliminationText(e.code), detail: e.detail, evidence_id: e.evidence_id ?? null })),
        agent_reason: rejected.find((x) => x.option_id === option.option_id)?.reason ?? null,
      };
    }
    case "compare": {
      const a = resolveId(command.a, "OPT", optionIds, "option");
      const b = resolveId(command.b, "OPT", optionIds, "option");
      if (!a.ok) return error(a.error, a.candidates);
      if (!b.ok) return error(b.error, b.candidates);
      return { type: "compare", options: [a.id, b.id].map((id) => view.options.find((o) => o.option_id === id)!), recommended_id: rec?.option_id ?? null };
    }
    case "evidence": {
      const hit = findEvidence(view, command.id);
      return { type: "evidence", evidence_id: command.id, found: !!hit, pointer: hit?.pointer ?? null, label: hit?.label ?? null, value: hit?.value ?? null };
    }
    case "trace": {
      const runs = view.agents.runs;
      if (!runs.length) return error("No agent has run on this case: every step so far was deterministic.");
      if (!command.run) return { type: "trace", run: runs.at(-1)! };
      const r = resolveId(command.run, "RUN", runs.map((x) => x.run_id), "agent run");
      return r.ok ? { type: "trace", run: runs.find((x) => x.run_id === r.id)! } : error(r.error, r.candidates);
    }
    case "ledger": {
      const entries = view.evidence.ledger.entries;
      return { type: "ledger", entries: entries.slice(-(command.count ?? 10)), total: entries.length };
    }
    case "exec": {
      const muts = view.execution.mutations;
      if (!muts.length) return error("Nothing has been sent to the mutation gateway for this case yet.");
      if (!command.mutation) return { type: "mutation", mutations: muts };
      const r = resolveId(command.mutation, "MUT", muts.map((m) => m.mutation_id), "mutation");
      return r.ok ? { type: "mutation", mutations: muts.filter((m) => m.mutation_id === r.id) } : error(r.error, r.candidates);
    }
    case "outcome":
      return { type: "outcome", lots: view.outcome.lots, claims: view.outcome.claims };
    case "policy":
      return { type: "policy", policy: view.governance.policy, evaluation: view.governance.evaluations.at(-1) ?? null };
    case "approvals":
      return {
        type: "approvals",
        approvals: view.governance.approvals,
        my_actions: view.viewer.available_actions
          .filter((a) => a.action === "DECIDE_APPROVAL")
          .map((a) => ({ approval_id: a.approval_id ?? null, enabled: a.enabled, text: actionText(a) })),
      };
    default:
      return error(`${command.verb} is not a read command.`);
  }
}
