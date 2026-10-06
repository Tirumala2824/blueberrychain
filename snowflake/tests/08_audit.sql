-- WP7b audit checks. Each test passes when its LAST statement returns zero rows.

-- test: the live ledger verifies
CALL BBC_OS.API.VERIFY_LEDGER('BBC_OS.LEDGER.ENTRIES');
SELECT $1 FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE NOT $1:ok::BOOLEAN;

-- test: tampering with one row of a zero-copy clone is detected at that exact seq
CREATE OR REPLACE TRANSIENT TABLE BBC_OS.LEDGER.T_TAMPER_CLONE CLONE BBC_OS.LEDGER.ENTRIES;
UPDATE BBC_OS.LEDGER.T_TAMPER_CLONE SET actor = 'MALLORY' WHERE seq = 5;
CALL BBC_OS.API.VERIFY_LEDGER('BBC_OS.LEDGER.T_TAMPER_CLONE');
CREATE OR REPLACE TEMPORARY TABLE BBC_OS.LEDGER.T_TAMPER_RESULT AS SELECT $1 AS r FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
DROP TABLE BBC_OS.LEDGER.T_TAMPER_CLONE;
SELECT r FROM BBC_OS.LEDGER.T_TAMPER_RESULT
WHERE r:ok::BOOLEAN OR r:first_bad_seq::NUMBER <> 5 OR r:reason::STRING <> 'ENTRY_HASH_MISMATCH';

-- test: a re-hashed edit still breaks the next entry's prev link
CREATE OR REPLACE TRANSIENT TABLE BBC_OS.LEDGER.T_TAMPER_CLONE CLONE BBC_OS.LEDGER.ENTRIES;
UPDATE BBC_OS.LEDGER.T_TAMPER_CLONE SET actor = 'MALLORY',
  entry_hash = BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_CONSTRUCT_KEEP_NULL(
    'seq', seq, 'ts', ts, 'entry_type', entry_type, 'case_id', case_id, 'actor', 'MALLORY',
    'record_ref', record_ref, 'payload_hash', payload_hash, 'prev_hash', prev_hash))
WHERE seq = 5;
CALL BBC_OS.API.VERIFY_LEDGER('BBC_OS.LEDGER.T_TAMPER_CLONE');
CREATE OR REPLACE TEMPORARY TABLE BBC_OS.LEDGER.T_TAMPER_RESULT AS SELECT $1 AS r FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
DROP TABLE BBC_OS.LEDGER.T_TAMPER_CLONE;
SELECT r FROM BBC_OS.LEDGER.T_TAMPER_RESULT
WHERE r:ok::BOOLEAN OR r:first_bad_seq::NUMBER <> 6 OR r:reason::STRING <> 'PREV_HASH_BREAK';

-- test: the gateway view only lists mutations whose authorization hash recomputes
SELECT d.mutation_id FROM BBC_OS.API.V_DISPATCHABLE d
JOIN BBC_OS.DECISION.MUTATIONS m ON m.mutation_id = d.mutation_id
WHERE m.status <> 'AUTHORIZED';

-- test: the agent role has no USAGE on gateway write procedures
SHOW GRANTS TO ROLE BBC_AGENT_RUNTIME;
SELECT "name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "privilege" = 'USAGE' AND ("name" ILIKE '%MUTATE%' OR "name" ILIKE '%EXECUTE_PLAN%'
   OR "name" ILIKE '%ACK_MUTATION%' OR "name" ILIKE '%DECIDE_APPROVAL%');

-- test: only the governance admin can stop dispatch
SHOW GRANTS ON PROCEDURE BBC_OS.API.EMERGENCY_STOP(STRING);
SELECT "grantee_name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "privilege" = 'USAGE' AND "grantee_name" NOT IN ('BBC_GOVERNANCE_ADMIN');
