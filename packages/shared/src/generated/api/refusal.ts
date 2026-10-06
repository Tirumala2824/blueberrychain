/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

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
