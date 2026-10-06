/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.CLAIM_WORK(worker_id, lease_s) (82_stages.sql): lease the next case that needs a step. `case_id` null = nothing to do. `next.kind`: ADVANCE (call API.ADVANCE_CASE with expected_state), AGENT (target = the agent to run), ENGINE (target = EXECUTE_PLAN; needs `rec_id`, requested), HUMAN (never leased: PENDING_APPROVAL is excluded).
 */
export type CLAIM_WORKResult =
  | APIRefusal
  | {
      status: "OK";
      case_id: null;
    }
  | {
      status: "OK";
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
      state_version: number;
      /**
       * Requested: START_AGENT_RUN needs it for AGENT work.
       */
      decision_point?: "D1" | "D2";
      /**
       * Requested: EXECUTE_PLAN(case_id, rec_id) needs it for ENGINE work; the engine role can't read DECISION.CASES.
       */
      rec_id?: string;
      next: {
        kind: "ADVANCE" | "AGENT" | "ENGINE" | "HUMAN";
        call?: string;
        target?: string;
        expected_state:
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
      };
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
