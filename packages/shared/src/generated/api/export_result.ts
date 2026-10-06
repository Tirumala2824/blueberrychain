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
