/**
 * How the control tower groups the design's 11 lifecycle stages (LIFECYCLE_STAGES) and
 * 27 case states into the 8 stages of its lifecycle rail. Presentation only: the rail
 * shows where a case is; what anyone may do next comes from Snowflake
 * (`viewer.available_actions` in the case view), never from this table.
 */

export const CASE_STATES = [
  "OPEN", "ASSESSED", "FORENSICS_PENDING", "FINDING_RECORDED", "OPTIONS_SCORED",
  "STRATEGY_PENDING", "CLAIMS_PENDING", "RECOMMENDED", "AUDIT_PENDING", "AUDITED",
  "AUTO_APPROVED", "PENDING_APPROVAL", "APPROVED", "ALTERNATIVE_CHOSEN", "REJECTED",
  "DENIED", "SHADOW_RECORDED", "EXECUTING", "EXECUTED", "EXECUTION_FAILED",
  "FALLBACK_EXECUTED", "AWAITING_OUTCOME", "OUTCOME_RECORDED", "CLAIM_OPEN",
  "SETTLED", "ABSORBED", "SEALED",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const COCKPIT_STAGES = [
  "EVENT", "ANALYSIS", "OPTIONS", "DECISION", "APPROVAL", "EXECUTION", "OUTCOME", "EVIDENCE",
] as const;
export type CockpitStage = (typeof COCKPIT_STAGES)[number];

const STAGE_OF: Record<CaseState, CockpitStage> = {
  OPEN: "EVENT",
  ASSESSED: "ANALYSIS",
  FORENSICS_PENDING: "ANALYSIS",
  FINDING_RECORDED: "ANALYSIS",
  OPTIONS_SCORED: "OPTIONS",
  STRATEGY_PENDING: "DECISION",
  CLAIMS_PENDING: "DECISION",
  RECOMMENDED: "DECISION",
  AUDIT_PENDING: "DECISION",
  AUDITED: "DECISION",
  AUTO_APPROVED: "APPROVAL",
  PENDING_APPROVAL: "APPROVAL",
  APPROVED: "APPROVAL",
  ALTERNATIVE_CHOSEN: "APPROVAL",
  REJECTED: "APPROVAL",
  DENIED: "APPROVAL",
  SHADOW_RECORDED: "APPROVAL",
  EXECUTING: "EXECUTION",
  EXECUTED: "EXECUTION",
  EXECUTION_FAILED: "EXECUTION",
  FALLBACK_EXECUTED: "EXECUTION",
  AWAITING_OUTCOME: "OUTCOME",
  OUTCOME_RECORDED: "OUTCOME",
  CLAIM_OPEN: "OUTCOME",
  SETTLED: "OUTCOME",
  ABSORBED: "OUTCOME",
  SEALED: "EVIDENCE",
};

/** The rail stage a case state belongs to. */
export function cockpitStageOf(state: CaseState): CockpitStage {
  return STAGE_OF[state];
}
