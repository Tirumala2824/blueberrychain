/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.ACK_MUTATION(mutation_id, report), called by the engine. Snowflake re-checks the report against the intent, records it, advances the plan and the case, and writes the ledger.
 */
export type ACK_MUTATIONResult =
  | APIRefusal
  | {
      status: "OK";
      mutation_id: string;
      mutation_status:
        | "PROPOSED"
        | "VALIDATED"
        | "PENDING_APPROVAL"
        | "AUTHORIZED"
        | "REJECTED"
        | "EXPIRED"
        | "PREPARED"
        | "DISPATCHED"
        | "ACKED"
        | "VERIFIED"
        | "ABORTED_PRECONDITION"
        | "CONFLICT"
        | "FAILED"
        | "COMPENSATING"
        | "COMPENSATED"
        | "SHADOW";
      plan_status: ("PLANNED" | "EXECUTING" | "DONE" | "PARTIAL" | "COMPENSATING" | "COMPENSATED" | "FAILED") | null;
      case_state:
        | (
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
            | "SEALED"
          )
        | null;
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
