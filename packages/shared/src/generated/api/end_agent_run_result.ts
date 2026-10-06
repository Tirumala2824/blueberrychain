/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.END_AGENT_RUN(run_id, record), called by the engine: closes the run, records the trace and releases the case lease.
 */
export type END_AGENT_RUNResult =
  | APIRefusal
  | {
      status: "OK";
      run_id: string;
      run_status: "COMPLETED" | "FAILED" | "EXPIRED";
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
