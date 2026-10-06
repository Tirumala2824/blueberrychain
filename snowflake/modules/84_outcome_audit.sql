-- =============================================================================
-- BlueberryChain OS - WP7b (audit part): ledger verification. Recomputes every payload
-- hash, entry hash and prev link of a ledger table (LEDGER.ENTRIES or a zero-copy clone)
-- and returns the first broken seq. Same checks as snowflake/tests/02_ledger.sql and
-- bbc_toolkit.ledger.verify_chain.
-- Prerequisites: 40_ledger.sql, 50_governed_procs.sql (LEDGER.CANONICAL_HASH).
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;

CREATE OR REPLACE PROCEDURE BBC_OS.API.VERIFY_LEDGER(LEDGER_TABLE STRING)
  RETURNS VARIANT
  LANGUAGE SQL
  COMMENT = 'Recompute the hash chain of LEDGER_TABLE (default BBC_OS.LEDGER.ENTRIES): {ok, entries, first_bad_seq, reason}.'
  EXECUTE AS OWNER
AS
$$
DECLARE
  tbl STRING DEFAULT COALESCE(NULLIF(:LEDGER_TABLE, ''), 'BBC_OS.LEDGER.ENTRIES');
  n NUMBER;
  bad_seq NUMBER;
  bad_reason STRING;
BEGIN
  SELECT COUNT(*) INTO :n FROM IDENTIFIER(:tbl);
  WITH e AS (
    SELECT seq, payload_hash, prev_hash, entry_hash,
           LAG(entry_hash) OVER (ORDER BY seq) AS expected_prev,
           LAG(seq) OVER (ORDER BY seq) AS prev_seq,
           BBC_OS.LEDGER.CANONICAL_HASH(payload) AS payload_recomputed,
           BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_CONSTRUCT_KEEP_NULL(
             'seq', seq, 'ts', ts, 'entry_type', entry_type, 'case_id', case_id, 'actor', actor,
             'record_ref', record_ref, 'payload_hash', payload_hash, 'prev_hash', prev_hash)) AS entry_recomputed
    FROM IDENTIFIER(:tbl)
  )
  SELECT MIN(seq),
         MIN_BY(CASE WHEN payload_recomputed <> payload_hash THEN 'PAYLOAD_HASH_MISMATCH'
                     WHEN entry_recomputed <> entry_hash THEN 'ENTRY_HASH_MISMATCH'
                     WHEN prev_hash <> COALESCE(expected_prev, REPEAT('0', 64)) THEN 'PREV_HASH_BREAK'
                     ELSE 'SEQ_GAP' END, seq)
    INTO :bad_seq, :bad_reason
  FROM e
  WHERE payload_recomputed <> payload_hash
     OR entry_recomputed <> entry_hash
     OR prev_hash <> COALESCE(expected_prev, REPEAT('0', 64))
     OR seq <> COALESCE(prev_seq, 0) + 1;
  RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', :bad_seq IS NULL, 'table', :tbl, 'entries', :n,
                                    'first_bad_seq', :bad_seq, 'reason', :bad_reason);
EXCEPTION
  WHEN OTHER THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'table', :tbl, 'error', SQLERRM);
END;
$$;

GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_AUDITOR;
GRANT USAGE ON PROCEDURE BBC_OS.API.VERIFY_LEDGER(STRING) TO ROLE BBC_AUDITOR;
