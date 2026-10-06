-- WP2 ledger checks. Each test passes when its LAST statement returns zero rows.

-- test: HEAD agrees with the last ledger entry
WITH last_entry AS (
  SELECT seq, entry_hash FROM BBC_OS.LEDGER.ENTRIES QUALIFY ROW_NUMBER() OVER (ORDER BY seq DESC) = 1
)
SELECT h.last_seq, h.last_hash
FROM BBC_OS.LEDGER.HEAD h
LEFT JOIN last_entry l ON TRUE
WHERE h.id = 1
  AND (COALESCE(l.seq, 0) <> h.last_seq OR COALESCE(l.entry_hash, REPEAT('0', 64)) <> h.last_hash);

-- test: every entry re-hashes, links to its predecessor, and seq has no gaps
WITH e AS (
  SELECT
    seq, payload_hash, prev_hash, entry_hash,
    LAG(entry_hash) OVER (ORDER BY seq) AS expected_prev,
    LAG(seq) OVER (ORDER BY seq) AS prev_seq,
    BBC_OS.LEDGER.CANONICAL_HASH(payload) AS payload_recomputed,
    BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_CONSTRUCT_KEEP_NULL(
      'seq', seq, 'ts', ts, 'entry_type', entry_type, 'case_id', case_id, 'actor', actor,
      'record_ref', record_ref, 'payload_hash', payload_hash, 'prev_hash', prev_hash)) AS entry_recomputed
  FROM BBC_OS.LEDGER.ENTRIES
)
SELECT seq,
       CASE WHEN payload_recomputed <> payload_hash THEN 'PAYLOAD_HASH_MISMATCH'
            WHEN entry_recomputed <> entry_hash THEN 'ENTRY_HASH_MISMATCH'
            WHEN prev_hash <> COALESCE(expected_prev, REPEAT('0', 64)) THEN 'PREV_HASH_BREAK'
            ELSE 'SEQ_GAP' END AS violation
FROM e
WHERE payload_recomputed <> payload_hash
   OR entry_recomputed <> entry_hash
   OR prev_hash <> COALESCE(expected_prev, REPEAT('0', 64))
   OR seq <> COALESCE(prev_seq, 0) + 1;

-- test: no role other than the owner can write ledger entries
SHOW GRANTS ON TABLE BBC_OS.LEDGER.ENTRIES;
WITH g AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT "privilege", "grantee_name" FROM g
WHERE "privilege" IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE') AND "grantee_name" <> 'BBC_OWNER';

-- test: no role other than the owner can write the ledger head
SHOW GRANTS ON TABLE BBC_OS.LEDGER.HEAD;
WITH g AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT "privilege", "grantee_name" FROM g
WHERE "privilege" IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE') AND "grantee_name" <> 'BBC_OWNER';
