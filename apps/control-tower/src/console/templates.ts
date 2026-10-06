/**
 * Plain-language text for the codes the read model carries. Template text only:
 * the console never asks a model to explain a decision.
 */

export const STAGE_NAMES: Record<string, string> = {
  EVENT: "Event",
  ANALYSIS: "Analysis",
  OPTIONS: "Options",
  DECISION: "Decision",
  APPROVAL: "Approval",
  EXECUTION: "Execution",
  OUTCOME: "Outcome",
  EVIDENCE: "Evidence",
};

export const STATE_TEXT: Record<string, string> = {
  OPEN: "Detected; the engine is building the evidence pack.",
  ASSESSED: "Evidence pack sealed; routing to analysis.",
  FORENSICS_PENDING: "Evidence conflicts; Excursion Forensics is investigating the cause.",
  FINDING_RECORDED: "Cause recorded; options are being scored.",
  OPTIONS_SCORED: "Options scored against doing nothing; routing the decision.",
  STRATEGY_PENDING: "No option dominates; the Recovery Strategist is weighing them.",
  CLAIMS_PENDING: "Claims & Recovery is building the settlement position.",
  RECOMMENDED: "Recommendation recorded.",
  AUDIT_PENDING: "The Evidence Integrity Auditor is checking the AI-written text.",
  AUDITED: "Recommendation ready for policy evaluation.",
  AUTO_APPROVED: "Policy allows this to execute without approval.",
  PENDING_APPROVAL: "Waiting for approval.",
  APPROVED: "Approved; queued for the mutation gateway.",
  ALTERNATIVE_CHOSEN: "An approver chose another option; re-evaluating.",
  REJECTED: "Rejected; the safe fallback runs.",
  DENIED: "Policy denies this action.",
  SHADOW_RECORDED: "Shadow mode: recorded, nothing dispatched.",
  EXECUTING: "Executing through the mutation gateway.",
  EXECUTED: "Executed in the systems of record.",
  EXECUTION_FAILED: "Execution failed; compensations ran.",
  FALLBACK_EXECUTED: "The deadline passed; the safe fallback ran.",
  AWAITING_OUTCOME: "Waiting for the receipt inspection.",
  OUTCOME_RECORDED: "Outcome recorded against the prediction.",
  CLAIM_OPEN: "Claim filed; waiting for the counterparty.",
  SETTLED: "Settled.",
  ABSORBED: "Loss absorbed.",
  SEALED: "Sealed: the decision record is final and in memory.",
};

export const ELIMINATION_TEXT: Record<string, string> = {
  FOOD_SAFETY: "A food-safety limit rules it out: the product may only be held, inspected or disposed.",
  SPEC_INFEASIBLE: "It can't meet the customer's specification on arrival.",
  WINDOW_CLOSED: "The window to do it has closed (including the time approval needs).",
  CAPACITY: "The destination can't take the volume.",
  ORGANIC_INTEGRITY: "It would break organic integrity.",
  CONTRACT_PROHIBITS: "The contract doesn't allow it.",
  INVENTORY_STALE: "The stock it relies on is too old to trust.",
  INSUFFICIENT_EVIDENCE: "There isn't enough evidence to do it.",
};

export const ESCALATION_TEXT: Record<string, string> = {
  NO_FEASIBLE_OPTION: "No option is feasible.",
  NEAR_TIE: "The top options are within the near-tie margin.",
  HIGH_EXPOSURE: "The value at risk is above the escalation threshold.",
  EVIDENCE_CONFLICT: "Documents contradict the sensors.",
  STRATEGIC_CUSTOMER: "A tier-A customer commitment is affected.",
  MULTI_PARTY_LIABILITY: "Liability is split between parties.",
  CAUSE_AMBIGUOUS: "The cause is ambiguous.",
  MODEL_OUT_OF_RANGE: "The shelf-life model is outside its calibrated range.",
  QUALITATIVE_SIGNAL: "There is free-text evidence only judgment can weigh.",
  PRECEDENT_CONFLICT: "Similar past cases ended differently.",
  NOVEL: "Nothing like this has been seen before.",
};

export const DECIDER_TEXT: Record<string, string> = {
  RULE: "Decided by a rule. No AI was involved.",
  AGENT: "Chosen by an AI agent among options no other option beats; every number comes from the engine.",
  HUMAN: "Decided by a person.",
  FALLBACK: "The safe fallback, run because nothing else was executed in time.",
};

export const BRIEF_QUESTIONS = [
  "What happens if we do nothing?",
  "What can we do instead?",
  "What is each option worth?",
  "What rules options out?",
  "How do the options compare?",
  "What should we do, and why?",
];

export function humanizeCode(code: string): string {
  const text = code.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const eliminationText = (code: string) => ELIMINATION_TEXT[code] ?? humanizeCode(code);
export const escalationText = (code: string) => ESCALATION_TEXT[code] ?? humanizeCode(code);
export const stateText = (state: string) => STATE_TEXT[state] ?? humanizeCode(state);

export const ENTRY_TEXT: Record<string, string> = {
  CASE_OPENED: "Case opened by the detection task",
  CASE_LOT_ADDED: "Lot joined the case",
  ASSESSMENT_SEALED: "Evidence pack sealed",
  FINDING: "Cause recorded",
  OPTIONS_SCORED: "Options scored",
  RECOMMENDATION: "Recommendation recorded",
  AUDIT_VERDICT: "Audit verdict recorded",
  POLICY_EVALUATION: "Policy evaluated; approvals requested",
  APPROVAL: "Approval decided",
  ACTION_QUEUED: "Action queued at the mutation gateway",
  ACTION_ACKED: "Action confirmed by the target system",
  TRANSITION: "State changed",
  OUTCOME: "Outcome recorded",
  CLAIM_UPDATE: "Claim updated",
  CASE_SEALED: "Case sealed",
  AGENT_RUN: "Agent run",
  POLICY_ACTIVATED: "Policy activated",
  REFERENCE_CHANGED: "Reference data changed",
};

export const entryText = (type: string) => ENTRY_TEXT[type] ?? humanizeCode(type);

export type Lane = "Detection" | "Engine" | "Agents" | "People" | "Gateway";

/** Who acted, from the ledger's actor (a Snowflake user) and entry type. */
export function laneOf(entryType: string, actor: string): Lane {
  if (entryType.startsWith("ACTION_")) return "Gateway";
  if (actor === "SYSTEM") return "Detection";
  if (actor === "BBC_AGENT_SVC" || entryType === "AGENT_RUN" || entryType === "AUDIT_VERDICT") return "Agents";
  if (actor.startsWith("BBC_DEMO_") || entryType === "APPROVAL") return "People";
  return "Engine";
}
