/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.DECIDE_APPROVAL(approval_id, verdict, chosen_option_id, reason), called by a persona under their own identity. Snowflake enforces CURRENT_USER(), IS_ROLE_IN_SESSION(required_role), proposer != approver, Brief-hash freshness and the deadline; a refusal carries the reason code.
 */
export type DECIDE_APPROVALResult =
  | APIRefusal
  | {
      status: "OK";
      approval_id: string;
      approval_status: "APPROVED" | "ALTERNATIVE_CHOSEN" | "REJECTED";
      decided_by: string;
      decided_role: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
      decided_at: string;
      chosen_option_id: string | null;
      brief_hash: string;
      case_state:
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
      remaining_approval_ids: string[];
      ledger_seq: number;
    };

/**
 * What every API procedure returns when it refuses a call: INVALID (malformed input) or DENIED (governance said no). Matches the existing procedures ({status, errors}); `code` is a stable machine-readable reason for new procedures (see docs/frontend-spec.md, denial codes).
 */
export interface APIRefusal {
  status: "INVALID" | "DENIED";
  /**
   * @maxItems 50
   */
  errors: string[];
  code?: string;
}
