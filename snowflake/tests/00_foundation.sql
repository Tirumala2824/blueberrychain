-- WP1 foundation checks (run: `bbc test sql snowflake/tests/00_foundation.sql`).
-- Each test passes when its LAST statement returns zero rows; returned rows are violations.

-- test: database BBC_OS exists and is owned by BBC_OWNER
SHOW DATABASES LIKE 'BBC_OS';
WITH d AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT 'BBC_OS missing or not owned by BBC_OWNER' AS violation
WHERE NOT EXISTS (SELECT 1 FROM d WHERE "name" = 'BBC_OS' AND "owner" = 'BBC_OWNER');

-- test: all 11 schemas exist, use managed access, and PUBLIC is gone
WITH expected(schema_name) AS (
  SELECT column1 FROM VALUES ('RAW'), ('REF'), ('GOV'), ('OPS'), ('EVIDENCE'), ('DECISION'),
                             ('LEDGER'), ('SEM'), ('AGENT'), ('API'), ('MEMORY')
),
actual AS (
  SELECT schema_name, is_managed_access FROM BBC_OS.INFORMATION_SCHEMA.SCHEMATA
)
SELECT e.schema_name, 'missing' AS violation FROM expected e
WHERE e.schema_name NOT IN (SELECT schema_name FROM actual)
UNION ALL
SELECT a.schema_name, 'not managed access' FROM actual a
WHERE a.schema_name IN (SELECT schema_name FROM expected) AND a.is_managed_access <> 'YES'
UNION ALL
SELECT schema_name, 'PUBLIC should be dropped' FROM actual WHERE schema_name = 'PUBLIC';

-- test: Time Travel retention on BBC_OS is 30 days (spike S6; relax only if ADR-0002 records the fallback)
SHOW PARAMETERS LIKE 'DATA_RETENTION_TIME_IN_DAYS' IN DATABASE BBC_OS;
WITH p AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT "value" AS retention_days FROM p WHERE TRY_TO_NUMBER("value") < 30;

-- test: both warehouses exist, are X-Small, auto-suspend within 60s, and sit under BBC_MONITOR
SHOW WAREHOUSES LIKE 'BBC_%';
WITH w AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT e.column1 AS warehouse, 'missing or misconfigured' AS violation
FROM VALUES ('BBC_TRANSFORM_WH'), ('BBC_APP_WH') e
WHERE NOT EXISTS (
  SELECT 1 FROM w
  WHERE w."name" = e.column1 AND w."size" = 'X-Small' AND w."auto_suspend" <= 60
    AND w."resource_monitor" = 'BBC_MONITOR' AND w."owner" = 'BBC_OWNER'
);

-- test: the 9 BBC roles exist
SHOW ROLES LIKE 'BBC_%';
WITH r AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT e.column1 AS missing_role
FROM VALUES ('BBC_OWNER'), ('BBC_INGEST'), ('BBC_ENGINE'), ('BBC_AGENT_RUNTIME'),
            ('BBC_QUALITY_MGR'), ('BBC_SALES_MGR'), ('BBC_FINANCE_MGR'), ('BBC_AUDITOR'),
            ('BBC_GOVERNANCE_ADMIN') e
WHERE e.column1 NOT IN (SELECT "name" FROM r);

-- test: service and demo users default to their single runtime role and BBC_APP_WH
SHOW USERS LIKE 'BBC_%';
WITH u AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT e.column1 AS user_name, e.column2 AS expected_default_role
FROM VALUES ('BBC_INGEST_SVC', 'BBC_INGEST'), ('BBC_ENGINE_SVC', 'BBC_ENGINE'),
            ('BBC_AGENT_SVC', 'BBC_AGENT_RUNTIME'), ('BBC_DEMO_QUALITY', 'BBC_QUALITY_MGR'),
            ('BBC_DEMO_SALES', 'BBC_SALES_MGR'), ('BBC_DEMO_FINANCE', 'BBC_FINANCE_MGR'),
            ('BBC_DEMO_AUDITOR', 'BBC_AUDITOR'), ('BBC_DEMO_GOVADMIN', 'BBC_GOVERNANCE_ADMIN') e
WHERE NOT EXISTS (
  SELECT 1 FROM u
  WHERE u."name" = e.column1 AND u."default_role" = e.column2 AND u."default_warehouse" = 'BBC_APP_WH'
);

-- test: the agent runtime role inherits no other role and holds no table privileges
SHOW GRANTS TO ROLE BBC_AGENT_RUNTIME;
WITH g AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT "privilege", "granted_on", "name" FROM g
WHERE "granted_on" IN ('ROLE', 'TABLE', 'VIEW', 'DYNAMIC_TABLE', 'EXTERNAL_TABLE');

-- test: persona roles do not inherit each other (separation of duties)
SHOW GRANTS TO ROLE BBC_FINANCE_MGR;
WITH g AS (SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())))
SELECT "privilege", "granted_on", "name" FROM g WHERE "granted_on" = 'ROLE';
