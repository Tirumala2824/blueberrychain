-- WP2 policy checks (run after `bbc policy draft` + `bbc policy activate`).

-- test: exactly one policy version is ACTIVE
SELECT COUNT(*) AS active_versions FROM BBC_OS.GOV.POLICY_VERSIONS WHERE status = 'ACTIVE' HAVING COUNT(*) <> 1;

-- test: the active policy matches its content hash and was activated by someone other than its drafter
SELECT policy_version, drafted_by, activated_by FROM BBC_OS.GOV.POLICY_VERSIONS
WHERE status = 'ACTIVE'
  AND (BBC_OS.LEDGER.CANONICAL_HASH(document) <> content_hash OR activated_by IS NULL OR activated_by = drafted_by);

-- test: the activation is recorded in the ledger with the same content hash
SELECT p.policy_version FROM BBC_OS.GOV.POLICY_VERSIONS p
WHERE p.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM BBC_OS.LEDGER.ENTRIES e
    WHERE e.entry_type = 'POLICY_ACTIVATED'
      AND e.payload:policy_version::STRING = p.policy_version
      AND e.payload:content_hash::STRING = p.content_hash);

-- test: every section table holds exactly the rows of the active document
WITH v AS (SELECT policy_version AS pv, document AS d FROM BBC_OS.GOV.POLICY_VERSIONS WHERE status = 'ACTIVE'),
expected AS (
  SELECT 'DECISION_RIGHTS' AS t, ARRAY_SIZE(d:decision_rights) AS n FROM v
  UNION ALL SELECT 'ROUTER_RULES', ARRAY_SIZE(d:router_rules) FROM v
  UNION ALL SELECT 'HARD_LIMITS', ARRAY_SIZE(d:hard_limits) FROM v
  UNION ALL SELECT 'ACTION_TYPES', ARRAY_SIZE(d:action_types) FROM v
  UNION ALL SELECT 'MODEL_REGISTRY', ARRAY_SIZE(d:model_registry) FROM v
  UNION ALL SELECT 'METRIC_REGISTRY', ARRAY_SIZE(d:metric_registry) FROM v
  UNION ALL SELECT 'PARAMETERS', ARRAY_SIZE(OBJECT_KEYS(d:parameters)) FROM v
  UNION ALL SELECT 'AUTONOMY_THRESHOLDS', SUM(ARRAY_SIZE(f.value)) FROM v, LATERAL FLATTEN(input => v.d:autonomy_thresholds) f
),
actual AS (
  SELECT 'DECISION_RIGHTS' AS t, COUNT(*) AS n FROM BBC_OS.GOV.DECISION_RIGHTS WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'ROUTER_RULES', COUNT(*) FROM BBC_OS.GOV.ROUTER_RULES WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'HARD_LIMITS', COUNT(*) FROM BBC_OS.GOV.HARD_LIMITS WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'ACTION_TYPES', COUNT(*) FROM BBC_OS.GOV.ACTION_TYPES WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'MODEL_REGISTRY', COUNT(*) FROM BBC_OS.GOV.MODEL_REGISTRY WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'METRIC_REGISTRY', COUNT(*) FROM BBC_OS.GOV.METRIC_REGISTRY WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'PARAMETERS', COUNT(*) FROM BBC_OS.GOV.PARAMETERS WHERE policy_version IN (SELECT pv FROM v)
  UNION ALL SELECT 'AUTONOMY_THRESHOLDS', COUNT(*) FROM BBC_OS.GOV.AUTONOMY_THRESHOLDS WHERE policy_version IN (SELECT pv FROM v)
)
SELECT e.t AS section_table, a.n AS actual_rows, e.n AS expected_rows
FROM expected e LEFT JOIN actual a ON a.t = e.t
WHERE COALESCE(a.n, 0) <> e.n OR e.n = 0;

-- test: ACTIVE_POLICY_VERSION() returns the active version
WITH c AS (
  SELECT BBC_OS.GOV.ACTIVE_POLICY_VERSION() AS fn,
         (SELECT MAX(policy_version) FROM BBC_OS.GOV.POLICY_VERSIONS WHERE status = 'ACTIVE') AS tbl
)
SELECT fn, tbl FROM c WHERE fn IS DISTINCT FROM tbl OR fn IS NULL;
