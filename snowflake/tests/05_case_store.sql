-- WP6a checks: the decision store and detection.
-- Passes trivially before any excursion except the object checks (task, stream, lock, counters, grants).

-- test: a lot is in at most one open case
SELECT cl.lot_id, COUNT(DISTINCT c.case_id) AS open_cases
FROM BBC_OS.DECISION.CASE_LOTS cl JOIN BBC_OS.DECISION.CASES c ON c.case_id = cl.case_id
WHERE c.state <> 'SEALED'
GROUP BY cl.lot_id HAVING COUNT(DISTINCT c.case_id) > 1;

-- test: an episode (shipment, or lot at a site) has at most one open case
SELECT episode_key, COUNT(*) AS open_cases FROM BBC_OS.DECISION.CASES
WHERE state <> 'SEALED' GROUP BY episode_key HAVING COUNT(*) > 1;

-- test: case ids are unique, and a lot appears once per case (keys are not enforced)
SELECT 'CASES' AS tbl, case_id AS id FROM BBC_OS.DECISION.CASES GROUP BY case_id HAVING COUNT(*) > 1
UNION ALL
SELECT 'CASE_LOTS', case_id || '/' || lot_id FROM BBC_OS.DECISION.CASE_LOTS
GROUP BY case_id, lot_id HAVING COUNT(*) > 1;

-- test: every case has lots, and every case lot belongs to a case and is a known lot
SELECT 'case without lots' AS problem, c.case_id AS id FROM BBC_OS.DECISION.CASES c
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.CASE_LOTS cl WHERE cl.case_id = c.case_id)
UNION ALL
SELECT 'lot without case', cl.case_id || '/' || cl.lot_id FROM BBC_OS.DECISION.CASE_LOTS cl
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.CASES c WHERE c.case_id = cl.case_id)
UNION ALL
SELECT 'unknown lot', cl.case_id || '/' || cl.lot_id FROM BBC_OS.DECISION.CASE_LOTS cl
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.LOTS l WHERE l.lot_id = cl.lot_id);

-- test: case states and decision points are the contract's (contracts/schemas/common.json)
SELECT case_id, state, decision_point FROM BBC_OS.DECISION.CASES
WHERE state NOT IN ('OPEN', 'ASSESSED', 'FORENSICS_PENDING', 'FINDING_RECORDED', 'OPTIONS_SCORED',
                    'STRATEGY_PENDING', 'CLAIMS_PENDING', 'RECOMMENDED', 'AUDIT_PENDING', 'AUDITED',
                    'AUTO_APPROVED', 'PENDING_APPROVAL', 'APPROVED', 'ALTERNATIVE_CHOSEN', 'REJECTED',
                    'DENIED', 'SHADOW_RECORDED', 'EXECUTING', 'EXECUTED', 'EXECUTION_FAILED',
                    'FALLBACK_EXECUTED', 'AWAITING_OUTCOME', 'OUTCOME_RECORDED', 'CLAIM_OPEN',
                    'SETTLED', 'ABSORBED', 'SEALED')
   OR decision_point NOT IN ('D1', 'D2');

-- test: every case was opened on the ledger exactly once, with the facts it stores
SELECT c.case_id, e.n AS opened_entries
FROM BBC_OS.DECISION.CASES c
LEFT JOIN (SELECT case_id, COUNT(*) AS n, MAX(payload_hash) AS payload_hash
           FROM BBC_OS.LEDGER.ENTRIES WHERE entry_type = 'CASE_OPENED' GROUP BY case_id) e
  ON e.case_id = c.case_id
WHERE COALESCE(e.n, 0) <> 1
   OR e.payload_hash <> BBC_OS.LEDGER.CANONICAL_HASH(c.detection);

-- test: every lot that joined a case later is on the ledger
SELECT cl.case_id, cl.lot_id
FROM BBC_OS.DECISION.CASE_LOTS cl JOIN BBC_OS.DECISION.CASES c ON c.case_id = cl.case_id
WHERE NOT ARRAY_CONTAINS(cl.lot_id::VARIANT,
        TRANSFORM(c.detection:lots, l -> l:lot_id))   -- not among the lots it opened with
  AND NOT EXISTS (SELECT 1 FROM BBC_OS.LEDGER.ENTRIES e
                  WHERE e.case_id = cl.case_id AND e.entry_type = 'CASE_LOT_ADDED'
                    AND e.payload:lot_id::STRING = cl.lot_id);

-- test: a long breach in someone else's custody has a case (sound subset of the OPEN_CASES rule;
-- readings that arrived in the last 3 minutes may still be on their way through the task)
WITH lots AS (
  SELECT s.lot_id, s.as_of, l.grower_party_id, pr.tolerance_min
  FROM BBC_OS.OPS.LOT_THERMAL_STATE s
  JOIN BBC_OS.OPS.LOTS l ON l.lot_id = s.lot_id
  JOIN BBC_OS.REF.PRODUCTS pr ON pr.product_id = s.product_id AND pr.is_current
),
win AS (
  SELECT param_value::NUMBER AS window_min FROM BBC_OS.GOV.PARAMETERS
  WHERE policy_version = BBC_OS.GOV.ACTIVE_POLICY_VERSION() AND param_key = 'detection_window_min'
)
SELECT x.lot_id, SUM(ta.breach_min) AS breach_min_in_window, ANY_VALUE(x.tolerance_min) AS tolerance_min
FROM lots x CROSS JOIN win w
JOIN BBC_OS.OPS.TELEMETRY_ASSIGNED ta ON ta.lot_id = x.lot_id
WHERE ta.holder_party_id <> x.grower_party_id AND NOT ta.in_precool_window
  AND ta.reading_ts > DATEADD('minute', -w.window_min, x.as_of)
GROUP BY x.lot_id
HAVING SUM(ta.breach_min) > ANY_VALUE(x.tolerance_min)
   AND MAX(ta.received_at) < DATEADD('minute', -3, CURRENT_TIMESTAMP())
   AND NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.CASE_LOTS cl WHERE cl.lot_id = x.lot_id);

-- test: id counters are ahead of every id handed out
SELECT 'CASE' AS kind, MAX(TRY_TO_NUMBER(SPLIT_PART(case_id, '-', 2))) AS max_issued
FROM BBC_OS.DECISION.CASES
HAVING MAX(TRY_TO_NUMBER(SPLIT_PART(case_id, '-', 2))) >=
       (SELECT next_value FROM BBC_OS.DECISION.ID_COUNTERS WHERE kind = 'CASE');

-- test: the gateway lock row and all eleven id counters exist
SELECT 'gateway lock rows' AS item, COUNT(*) AS n FROM BBC_OS.DECISION.GATEWAY_LOCK HAVING COUNT(*) <> 1
UNION ALL
SELECT 'id counters', COUNT(*) FROM BBC_OS.DECISION.ID_COUNTERS
WHERE kind IN ('CASE', 'PACK', 'OPTION', 'REC', 'FINDING', 'EVAL', 'APPROVAL', 'MUTATION', 'PLAN',
               'CLAIM', 'RUN')
HAVING COUNT(*) <> 11;

-- test: only the owner writes the decision record; only auditors read it
SELECT grantee, table_schema, table_name, privilege_type
FROM BBC_OS.INFORMATION_SCHEMA.TABLE_PRIVILEGES
WHERE (table_schema = 'DECISION' OR (table_schema = 'EVIDENCE' AND table_name = 'EVIDENCE_PACKS'))
  AND grantee <> 'BBC_OWNER'
  AND NOT (grantee = 'BBC_AUDITOR' AND privilege_type = 'SELECT');

-- test: no role but the owner may call OPEN_CASES
SHOW GRANTS ON PROCEDURE BBC_OS.DECISION.OPEN_CASES();
SELECT "privilege", "grantee_name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "grantee_name" <> 'BBC_OWNER';

-- test: the detection stream exists and is not stale
SHOW STREAMS LIKE 'S_THERMAL_BUCKETS' IN SCHEMA BBC_OS.DECISION;
SELECT 'S_THERMAL_BUCKETS missing or stale' AS problem
FROM (SELECT COUNT_IF("stale" = 'false') AS healthy FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
WHERE healthy = 0;

-- test: the detection task is started
SHOW TASKS LIKE 'T_DETECT' IN SCHEMA BBC_OS.DECISION;
SELECT 'T_DETECT missing or not started' AS problem
FROM (SELECT COUNT_IF("state" = 'started') AS started FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
WHERE started = 0;

-- test: no detection run failed in the last day
SELECT scheduled_time, state, error_message
FROM TABLE(BBC_OS.INFORMATION_SCHEMA.TASK_HISTORY(
  TASK_NAME => 'T_DETECT', SCHEDULED_TIME_RANGE_START => DATEADD('day', -1, CURRENT_TIMESTAMP())))
WHERE state = 'FAILED';
