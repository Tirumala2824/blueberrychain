/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.EMERGENCY_STOP(reason): sets dispatch_enabled = false immediately. Resuming needs a policy activation.
 */
export type EMERGENCY_STOPResult =
  | APIRefusal
  | {
      status: "OK";
      dispatch_enabled: false;
      stopped_by: string;
      stopped_at: string;
      reason: string;
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
