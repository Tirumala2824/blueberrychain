/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.ADVANCE_CASE(case_id, expected_state) (82_stages.sql): run the next deterministic stage(s). STALE = the case is no longer in expected_state (someone else advanced it). `steps` record each stage run; `waiting_for` is [kind, target] when the case now waits for an agent or the engine, or [].
 */
export type ADVANCE_CASEResult =
  | APIRefusal
  | {
      status: "STALE";
      case_id: string;
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
    }
  | {
      status: "OK";
      case_id: string;
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
      /**
       * @maxItems 50
       */
      steps: {
        step: string;
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
        [k: string]: unknown;
      }[];
      /**
       * @maxItems 2
       */
      waiting_for: [] | [string] | [string, string];
    };

/**
 * What an API procedure returns when it refuses a call: INVALID (malformed input or a call that doesn't apply) or DENIED (governance said no). `errors` are strings or {code, message}; procedures may add context keys (case_id, state, steps).
 */
export interface APIRefusal {
  status: "INVALID" | "DENIED";
  /**
   * @maxItems 50
   */
  errors: (
    | string
    | {
        code: string;
        message: string;
        path?: string;
        [k: string]: unknown;
      }
  )[];
  code?: string;
  [k: string]: unknown;
}
