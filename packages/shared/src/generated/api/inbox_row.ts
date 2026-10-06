/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * One row of the view API.V_CASE_INBOX (column names lower-cased), read by persona roles. A projection of DECISION.CASES, CASE_LOTS, the open APPROVALS, the ACTIVE RECOMMENDATIONS row, the latest POLICY_EVALUATIONS row and MAX(LEDGER.ENTRIES.seq) for the case. Snowflake computes inbox_rank and awaiting_me; the app only orders and renders.
 */
export interface CaseInboxRow {
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  state:
    | "OPEN"
    | "ASSESSED"
    | "FORENSICS_PENDING"
    | "FINDING_RECORDED"
    | "OPTIONS_SCORED"
    | "STRATEGY_PENDING"
    | "CLAIMS_PENDING"
    | "RECOMMENDED"
    | "AUDIT_PENDING"
    | "AUDITED"
    | "AUTO_APPROVED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "ALTERNATIVE_CHOSEN"
    | "REJECTED"
    | "DENIED"
    | "SHADOW_RECORDED"
    | "EXECUTING"
    | "EXECUTED"
    | "EXECUTION_FAILED"
    | "FALLBACK_EXECUTED"
    | "AWAITING_OUTCOME"
    | "OUTCOME_RECORDED"
    | "CLAIM_OPEN"
    | "SETTLED"
    | "ABSORBED"
    | "SEALED";
  state_version: number;
  /**
   * state_version || ':' || last ledger seq of the case. Changes whenever anything about the case changes.
   */
  change_token: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  shipment_id: string | null;
  /**
   * @minItems 1
   */
  lot_ids: [string, ...string[]];
  opened_at: string;
  onset_at: string;
  deadline_ts: string | null;
  /**
   * Earliest due_at of the case's REQUESTED approvals.
   */
  due_at: string | null;
  /**
   * When the deadline watchdog will execute the safe fallback if nothing is executed first.
   */
  fallback_at: string | null;
  value_at_risk_usd: number | null;
  decided_by: ("RULE" | "AGENT" | "HUMAN" | "FALLBACK") | null;
  evaluation_outcome: ("AUTO" | "APPROVE" | "HUMAN_INITIATE" | "OBSERVE_ONLY" | "DENY") | null;
  autonomy_level: number | null;
  /**
   * Required roles of the case's REQUESTED approvals.
   */
  awaiting_roles: ("BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN")[];
  /**
   * True when a REQUESTED approval needs a role active in the caller's session (IS_ROLE_IN_SESSION) and the caller is not its proposer.
   */
  awaiting_me: boolean;
  needs_reassessment: boolean;
  /**
   * Position in the inbox: open cases by decision deadline and value at risk, computed in the view.
   */
  inbox_rank: number;
  is_open: boolean;
  sealed_at: string | null;
  policy_version: string;
  provenance: "LIVE" | "SIMULATION_BACKFILL";
  updated_at: string;
}
