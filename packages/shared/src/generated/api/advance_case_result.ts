/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.ADVANCE_CASE(case_id, expected_state), called by the engine. Runs the next deterministic stage(s) idempotently and enforces allowed transitions; refuses (DENIED, code STATE_MISMATCH) when expected_state is stale. Releases the lease.
 */
export type ADVANCE_CASEResult =
  | APIRefusal
  | {
      status: "OK";
      case_id: string;
      from_state:
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
      to_state:
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
       * @maxItems 50
       */
      transitions: {
        from:
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
        to:
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
        ledger_seq: number;
      }[];
      next: "ADVANCE" | "AGENT" | "WAIT_HUMAN" | "WAIT_EXTERNAL" | "DONE";
      lease_released: boolean;
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
