/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.VERIFY_LEDGER(from_seq, to_seq, ledger_table): recomputes the hash chain in Snowflake (bbc_toolkit.ledger.verify_chain). ledger_table may name a zero-copy clone for the tamper demonstration.
 */
export type VERIFY_LEDGERResult =
  | APIRefusal
  | {
      status: "OK";
      ledger_table: string;
      from_seq: number;
      to_seq: number;
      ok: boolean;
      checked: number;
      first_bad_seq: number | null;
      reason: "SEQ_GAP" | "PAYLOAD_HASH_MISMATCH" | "PREV_HASH_BREAK" | "ENTRY_HASH_MISMATCH" | null;
      bad_entry: {
        seq: number;
        expected_hash: string;
        actual_hash: string;
      } | null;
      verified_at: string;
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
