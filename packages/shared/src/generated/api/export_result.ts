/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.EXPORT_EVIDENCE_PACK(case_id): writes the pack(s) and the case's ledger slice as JSON to a stage and returns a presigned URL.
 */
export type EXPORT_EVIDENCE_PACKResult =
  | APIRefusal
  | {
      status: "OK";
      case_id: string;
      stage_path: string;
      url: string;
      url_expires_at: string;
      sha256: string;
      bytes: number;
      ledger_from_seq: number;
      ledger_to_seq: number;
      exported_at: string;
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
