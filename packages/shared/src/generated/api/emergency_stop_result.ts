/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.EMERGENCY_STOP(reason): dispatch stops at once; NEXT_ACTIONS answers STOPPED until a policy version is activated.
 */
export type EMERGENCY_STOPResult =
  | APIRefusal
  | {
      status: "OK";
      dispatch: "STOPPED";
      resume?: string;
      ledger_seq: number;
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
