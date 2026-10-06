/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.EXECUTE_PLAN(case_id, rec_id) (83_gateway.sql), called by the engine when CLAIM_WORK says ENGINE / EXECUTE_PLAN: writes the execution plan and passes every action of the approved bundle through DECISION.MUTATE in one transaction. Each step carries MUTATE's answer (mutation_id, mutation_status, errors).
 */
export type EXECUTE_PLANResult =
  | APIRefusal
  | {
      status: "OK";
      plan_id: string;
      atomicity: "ALL_OR_NOTHING" | "BEST_EFFORT";
      /**
       * @maxItems 50
       */
      steps: {
        step_seq: number;
        action_type:
          | "STOCK_BLOCK"
          | "STOCK_UNBLOCK"
          | "REQUEST_EVIDENCE"
          | "WITHDRAW_REQUEST"
          | "CLAIM_NOTICE"
          | "WITHDRAW_NOTICE"
          | "SO_CHANGE"
          | "SO_REVERT"
          | "REPLACEMENT_ALLOCATION"
          | "DEALLOCATE"
          | "REROUTE"
          | "REROUTE_BACK"
          | "REPROMISE_NOTICE"
          | "CORRECTION_NOTICE"
          | "SO_CREATE"
          | "CANCEL_SO"
          | "DISPOSE"
          | "FILE_CLAIM"
          | "WITHDRAW_CLAIM"
          | "GROWER_DEDUCTION"
          | "ABSORB"
          | "REVERSAL_POSTING"
          | "CASE_STATE";
        status: "OK" | "DUPLICATE" | "INVALID";
        mutation_id?: string;
        mutation_status?:
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
        [k: string]: unknown;
      }[];
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
