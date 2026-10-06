/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.REPLAY_EVIDENCE(pack_id): rebuilds the pack as of its as_of from append-only RAW (received_at <= as_of) and the recorded reference versions, then compares content hashes.
 */
export type REPLAY_EVIDENCEResult =
  | APIRefusal
  | {
      status: "OK";
      pack_id: string;
      as_of: string;
      original_hash: string;
      replayed_hash: string;
      equal: boolean;
      /**
       * @maxItems 50
       */
      diff: {
        path: string;
        original: unknown;
        replayed: unknown;
      }[];
      replayed_at: string;
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
