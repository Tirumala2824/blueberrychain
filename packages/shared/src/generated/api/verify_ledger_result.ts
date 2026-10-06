/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.VERIFY_LEDGER(ledger_table) (84_outcome_audit.sql): recomputes the whole hash chain of the table in Snowflake (NULL or '' = BBC_OS.LEDGER.ENTRIES; a zero-copy clone for the tamper demonstration). `error` is set when the table can't be read.
 */
export interface VERIFY_LEDGERResult {
  ok: boolean;
  table: string;
  entries?: number;
  first_bad_seq?: number | null;
  reason?: "SEQ_GAP" | "PAYLOAD_HASH_MISMATCH" | "PREV_HASH_BREAK" | "ENTRY_HASH_MISMATCH" | null;
  error?: string;
}
