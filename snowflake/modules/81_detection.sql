-- =============================================================================
-- BlueberryChain OS - WP6a: detection. Thermal buckets change -> the task fires ->
-- DECISION.OPEN_CASES opens, joins or extends Recovery Cases (with ledger entries).
-- Rule and episode logic: python/bbc_toolkit/src/bbc_toolkit/cases.py (unit-tested in
-- python/bbc_toolkit/tests/test_open_cases.py); the handler is bbc_toolkit.snow.proc_open_cases.
-- Prerequisites: 80_decision_store.sql; `uv run bbc deploy python` (toolkit with cases.py).
-- RUNTIME_VERSION follows spike S4. Spike S2 decides the task form (see below).
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;
USE SCHEMA BBC_OS.DECISION;

-- Every change to a lot's 15-minute thermal bucket. Recreate it whenever
-- OPS.LOT_THERMAL_BUCKETS is recreated (CREATE OR REPLACE makes a stream stale).
CREATE STREAM IF NOT EXISTS S_THERMAL_BUCKETS
  ON DYNAMIC TABLE BBC_OS.OPS.LOT_THERMAL_BUCKETS
  COMMENT = 'Consumed by OPEN_CASES inside its transaction (offset advances exactly once per run).';

CREATE OR REPLACE PROCEDURE OPEN_CASES()
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_open_cases'
  EXECUTE AS OWNER
  COMMENT = 'Internal only (the detection task). Opens / joins / extends cases; one open case per lot.';

-- S2 PASS: a triggered task (no schedule) - runs when the stream has data.
CREATE OR REPLACE TASK T_DETECT
  WAREHOUSE = BBC_TRANSFORM_WH
  WHEN SYSTEM$STREAM_HAS_DATA('BBC_OS.DECISION.S_THERMAL_BUCKETS')
  COMMENT = 'Detection: thermal bucket changes -> OPEN_CASES.'
AS
  CALL BBC_OS.DECISION.OPEN_CASES();

-- S2 FALLBACK (use instead of the task above if S2 recorded FALLBACK):
-- CREATE OR REPLACE TASK T_DETECT
--   WAREHOUSE = BBC_TRANSFORM_WH
--   SCHEDULE = '1 MINUTE'
--   WHEN SYSTEM$STREAM_HAS_DATA('BBC_OS.DECISION.S_THERMAL_BUCKETS')
--   COMMENT = 'Detection: thermal bucket changes -> OPEN_CASES (scheduled fallback, spike S2).'
-- AS
--   CALL BBC_OS.DECISION.OPEN_CASES();

ALTER TASK T_DETECT RESUME;
