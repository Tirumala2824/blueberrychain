-- =============================================================================
-- BlueberryChain OS - WP3: the only way into RAW
-- Connectors (BBC_INGEST, user BBC_INGEST_SVC) hold no table privileges. They call
-- API.INGEST_BATCH, which validates every row against its contract, recomputes its
-- idempotency key, MERGEs the valid rows, dead-letters the rest to RAW.INGEST_ERRORS
-- and advances the connector cursor - in one transaction.
-- Handlers: bbc_toolkit.snow.proc_ingest_batch / proc_get_connector_state
-- (tested in python/bbc_toolkit/tests/test_ingest.py).
-- RUNTIME_VERSION follows spike S4, as in 50_governed_procs.sql.
-- The rows parameter is BATCH_ROWS: ROWS is a reserved word (ADR-0007).
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;

CREATE OR REPLACE PROCEDURE BBC_OS.API.INGEST_BATCH(
    TARGET STRING, CONNECTOR_ID STRING, BATCH_ROWS VARIANT, STREAM STRING, CURSOR_VALUE STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_ingest_batch'
  COMMENT = 'Land a batch in RAW.TELEMETRY or RAW.BUSINESS_EVENTS (validated, idempotent, dead-lettered, cursor in the same transaction). STREAM and CURSOR_VALUE are empty strings for push sources.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.GET_CONNECTOR_STATE(CONNECTOR_ID STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_get_connector_state'
  COMMENT = 'Committed cursors per stream for one connector.'
  EXECUTE AS OWNER;

GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_INGEST;
GRANT USAGE ON PROCEDURE BBC_OS.API.INGEST_BATCH(STRING, STRING, VARIANT, STRING, STRING) TO ROLE BBC_INGEST;
GRANT USAGE ON PROCEDURE BBC_OS.API.GET_CONNECTOR_STATE(STRING)                       TO ROLE BBC_INGEST;
