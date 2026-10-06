-- =============================================================================
-- BlueberryChain OS - WP2: governed procedures (thin wrappers over bbc_toolkit.snow)
-- Prerequisite: `uv run bbc deploy python` has uploaded bbc_toolkit-0.1.0.zip.
-- Every handler is unit-tested locally (python/bbc_toolkit/tests/test_snow_handlers.py).
-- RUNTIME_VERSION follows spike S4 (use '3.11' everywhere if 3.12 was rejected).
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;

-- Canonical hash, identical to every writer. Used by verification and SQL tests.
CREATE OR REPLACE FUNCTION BBC_OS.LEDGER.CANONICAL_HASH(payload VARIANT)
  RETURNS STRING
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.udf_canonical_hash'
  COMMENT = 'sha256 of canonical JSON (bbc_toolkit.ledger).';

-- Internal: append one ledger entry in its own transaction (for SQL-scripted callers).
CREATE OR REPLACE PROCEDURE BBC_OS.LEDGER.APPEND(
    ENTRY_TYPE STRING, CASE_ID STRING, ACTOR STRING, RECORD_REF STRING, PAYLOAD VARIANT)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_ledger_append'
  COMMENT = 'Internal only - no runtime role has USAGE.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.APPLY_REFERENCE_CHANGE(ENTITY_TYPE STRING, RECORDS VARIANT, REASON STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_apply_reference_change'
  COMMENT = 'Validate a reference batch against its contract and write new versions for changed records (ledgered).'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.DRAFT_POLICY(DOCUMENT VARIANT)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_draft_policy'
  COMMENT = 'Validate a policy document (schema + semantics) and store it as a DRAFT (ledgered).'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.ACTIVATE_POLICY(POLICY_VERSION STRING, REASON STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip')
  HANDLER = 'bbc_toolkit.snow.proc_activate_policy'
  COMMENT = 'Activate a DRAFT policy; the drafter cannot activate it (ledgered).'
  EXECUTE AS OWNER;

-- Grants: governance admin drafts reference changes and activates policy; auditors read the ledger.
GRANT USAGE ON PROCEDURE BBC_OS.API.APPLY_REFERENCE_CHANGE(STRING, VARIANT, STRING) TO ROLE BBC_GOVERNANCE_ADMIN;
GRANT USAGE ON PROCEDURE BBC_OS.API.DRAFT_POLICY(VARIANT)                          TO ROLE BBC_GOVERNANCE_ADMIN;
GRANT USAGE ON PROCEDURE BBC_OS.API.ACTIVATE_POLICY(STRING, STRING)                TO ROLE BBC_GOVERNANCE_ADMIN;
GRANT SELECT ON ALL TABLES IN SCHEMA BBC_OS.GOV                                    TO ROLE BBC_GOVERNANCE_ADMIN;
GRANT SELECT ON TABLE BBC_OS.LEDGER.ENTRIES                                        TO ROLE BBC_AUDITOR;
GRANT USAGE ON FUNCTION BBC_OS.LEDGER.CANONICAL_HASH(VARIANT)                       TO ROLE BBC_AUDITOR;
