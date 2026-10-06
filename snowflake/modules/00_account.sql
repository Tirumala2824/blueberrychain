-- =============================================================================
-- BlueberryChain OS - WP1 foundation (account level)
-- Run as ACCOUNTADMIN. Idempotent: safe to re-run.
-- Creates roles, warehouses (+ resource monitor), the BBC_OS database and its
-- 11 managed-access schemas, a PAT-only authentication policy, and the
-- service + demo users. Object-level grants arrive with each later work package.
--
-- Naming: the case-lifecycle schema is DECISION (CASE is a reserved word).
-- Tokens are created separately in 00b_tokens.sql (secrets are shown once).
-- =============================================================================
USE ROLE ACCOUNTADMIN;

-- -----------------------------------------------------------------------------
-- 1. Roles (least privilege; runtime roles never inherit each other)
-- -----------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS BBC_OWNER            COMMENT = 'Owns every BBC_OS object; procedures run with its rights. Not used by people or apps at runtime.';
CREATE ROLE IF NOT EXISTS BBC_INGEST           COMMENT = 'Connectors: INSERT into RAW and write to the document stage only.';
CREATE ROLE IF NOT EXISTS BBC_ENGINE           COMMENT = 'Engine worker and dispatcher: engine procedures in API only.';
CREATE ROLE IF NOT EXISTS BBC_AGENT_RUNTIME    COMMENT = 'Cortex Agents: USAGE on agent tools only. No table privileges.';
CREATE ROLE IF NOT EXISTS BBC_QUALITY_MGR      COMMENT = 'Quality & operations manager approvals (also the "Ops" approver).';
CREATE ROLE IF NOT EXISTS BBC_SALES_MGR        COMMENT = 'Sales / order-promise manager approvals.';
CREATE ROLE IF NOT EXISTS BBC_FINANCE_MGR      COMMENT = 'Finance / AR approvals (claims, deductions, write-offs).';
CREATE ROLE IF NOT EXISTS BBC_AUDITOR          COMMENT = 'Read the ledger, run verification and replay.';
CREATE ROLE IF NOT EXISTS BBC_GOVERNANCE_ADMIN COMMENT = 'Activate policy versions and reference-data changes.';

-- Builders (the CoCo session user) assume BBC_OWNER; administrators can assume
-- the runtime roles to test tools. Approval separation of duties is enforced on
-- the *user* identity inside procedures, not on role membership alone.
SET builder = CURRENT_USER();
GRANT ROLE BBC_OWNER TO USER IDENTIFIER($builder);
GRANT ROLE BBC_OWNER            TO ROLE SYSADMIN;
GRANT ROLE BBC_INGEST           TO ROLE SYSADMIN;
GRANT ROLE BBC_ENGINE           TO ROLE SYSADMIN;
GRANT ROLE BBC_AGENT_RUNTIME    TO ROLE SYSADMIN;
GRANT ROLE BBC_QUALITY_MGR      TO ROLE SYSADMIN;
GRANT ROLE BBC_SALES_MGR        TO ROLE SYSADMIN;
GRANT ROLE BBC_FINANCE_MGR      TO ROLE SYSADMIN;
GRANT ROLE BBC_AUDITOR          TO ROLE SYSADMIN;
GRANT ROLE BBC_GOVERNANCE_ADMIN TO ROLE SYSADMIN;

-- -----------------------------------------------------------------------------
-- 2. Account privileges
-- -----------------------------------------------------------------------------
GRANT EXECUTE TASK         ON ACCOUNT TO ROLE BBC_OWNER;
GRANT EXECUTE MANAGED TASK ON ACCOUNT TO ROLE BBC_OWNER;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE BBC_OWNER;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE BBC_AGENT_RUNTIME;
-- Required on this account (prior build: AI calls failed with "Unknown function AI_COMPLETE" without it).
GRANT USE AI FUNCTIONS ON ACCOUNT TO ROLE BBC_OWNER;
GRANT USE AI FUNCTIONS ON ACCOUNT TO ROLE BBC_AGENT_RUNTIME;

-- -----------------------------------------------------------------------------
-- 3. Warehouses + cost guard (trial credits are finite)
-- -----------------------------------------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS BBC_TRANSFORM_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Dynamic Table refresh and tasks (separate for cost attribution).';
CREATE WAREHOUSE IF NOT EXISTS BBC_APP_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Procedures, agents and the API.';

CREATE RESOURCE MONITOR IF NOT EXISTS BBC_MONITOR
  WITH CREDIT_QUOTA = 50 FREQUENCY = MONTHLY START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 75 PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND;
ALTER WAREHOUSE BBC_TRANSFORM_WH SET RESOURCE_MONITOR = BBC_MONITOR;
ALTER WAREHOUSE BBC_APP_WH       SET RESOURCE_MONITOR = BBC_MONITOR;

GRANT OWNERSHIP ON WAREHOUSE BBC_TRANSFORM_WH TO ROLE BBC_OWNER COPY CURRENT GRANTS;
GRANT OWNERSHIP ON WAREHOUSE BBC_APP_WH       TO ROLE BBC_OWNER COPY CURRENT GRANTS;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_INGEST;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_ENGINE;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_AGENT_RUNTIME;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_QUALITY_MGR;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_SALES_MGR;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_FINANCE_MGR;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_AUDITOR;
GRANT USAGE ON WAREHOUSE BBC_APP_WH TO ROLE BBC_GOVERNANCE_ADMIN;

-- -----------------------------------------------------------------------------
-- 4. Database + 11 managed-access schemas
--    Spike S6: if the edition rejects 30 days, re-run with 1 (replay does not
--    depend on Time Travel) and record it in ADR-0002.
-- -----------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS BBC_OS
  DATA_RETENTION_TIME_IN_DAYS = 30
  COMMENT = 'BlueberryChain OS - governed excursion value recovery';
GRANT OWNERSHIP ON DATABASE BBC_OS TO ROLE BBC_OWNER COPY CURRENT GRANTS;

USE ROLE BBC_OWNER;
CREATE SCHEMA IF NOT EXISTS BBC_OS.RAW      WITH MANAGED ACCESS COMMENT = 'Append-only landing written by connectors.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.REF      WITH MANAGED ACCESS COMMENT = 'Versioned reference data (written only via APPLY_REFERENCE_CHANGE).';
CREATE SCHEMA IF NOT EXISTS BBC_OS.GOV      WITH MANAGED ACCESS COMMENT = 'Versioned policy (activated only via ACTIVATE_POLICY).';
CREATE SCHEMA IF NOT EXISTS BBC_OS.OPS      WITH MANAGED ACCESS COMMENT = 'Typed operational facts and thermal state (Dynamic Tables).';
CREATE SCHEMA IF NOT EXISTS BBC_OS.EVIDENCE WITH MANAGED ACCESS COMMENT = 'Documents, extracted claims, consistency checks, evidence packs.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.DECISION WITH MANAGED ACCESS COMMENT = 'Recovery Case lifecycle records, mutations (outbox), execution gateway.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.LEDGER   WITH MANAGED ACCESS COMMENT = 'Hash-chained, append-only audit trail.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.SEM      WITH MANAGED ACCESS COMMENT = 'Decision semantic view.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.AGENT    WITH MANAGED ACCESS COMMENT = 'Cortex Agents and the controlled tools they may call.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.API      WITH MANAGED ACCESS COMMENT = 'The only procedures application roles may call.';
CREATE SCHEMA IF NOT EXISTS BBC_OS.MEMORY   WITH MANAGED ACCESS COMMENT = 'Sealed decision memory and calibration.';
DROP SCHEMA IF EXISTS BBC_OS.PUBLIC;

-- Schema usage per role (object privileges are granted by later work packages)
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_INGEST;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_ENGINE;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_AGENT_RUNTIME;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_QUALITY_MGR;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_SALES_MGR;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_FINANCE_MGR;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_AUDITOR;
GRANT USAGE ON DATABASE BBC_OS TO ROLE BBC_GOVERNANCE_ADMIN;

GRANT USAGE ON SCHEMA BBC_OS.RAW      TO ROLE BBC_INGEST;
GRANT USAGE ON SCHEMA BBC_OS.EVIDENCE TO ROLE BBC_INGEST;
GRANT USAGE ON SCHEMA BBC_OS.API      TO ROLE BBC_ENGINE;
GRANT USAGE ON SCHEMA BBC_OS.AGENT    TO ROLE BBC_AGENT_RUNTIME;
GRANT USAGE ON SCHEMA BBC_OS.API      TO ROLE BBC_QUALITY_MGR;
GRANT USAGE ON SCHEMA BBC_OS.API      TO ROLE BBC_SALES_MGR;
GRANT USAGE ON SCHEMA BBC_OS.API      TO ROLE BBC_FINANCE_MGR;
GRANT USAGE ON SCHEMA BBC_OS.API      TO ROLE BBC_AUDITOR;
GRANT USAGE ON SCHEMA BBC_OS.LEDGER   TO ROLE BBC_AUDITOR;
GRANT USAGE ON SCHEMA BBC_OS.DECISION TO ROLE BBC_AUDITOR;
GRANT USAGE ON SCHEMA BBC_OS.EVIDENCE TO ROLE BBC_AUDITOR;
GRANT USAGE ON SCHEMA BBC_OS.API      TO ROLE BBC_GOVERNANCE_ADMIN;
GRANT USAGE ON SCHEMA BBC_OS.GOV      TO ROLE BBC_GOVERNANCE_ADMIN;

-- -----------------------------------------------------------------------------
-- 5. PAT-only authentication policy (service and demo users never use passwords)
--    NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED lets PATs work without a
--    network policy on this trial account; tighten with a network policy later.
-- -----------------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;
CREATE AUTHENTICATION POLICY IF NOT EXISTS BBC_OS.GOV.BBC_PAT_ONLY
  AUTHENTICATION_METHODS = ('PROGRAMMATIC_ACCESS_TOKEN')
  PAT_POLICY = (
    DEFAULT_EXPIRY_IN_DAYS = 30,
    MAX_EXPIRY_IN_DAYS = 90,
    NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED
  )
  COMMENT = 'BBC service and demo users authenticate with role-restricted PATs only.';

-- -----------------------------------------------------------------------------
-- 6. Users. Cortex Agents take permissions from the caller's DEFAULT role, so
--    every user's default role is its single runtime role.
-- -----------------------------------------------------------------------------
CREATE USER IF NOT EXISTS BBC_INGEST_SVC TYPE = SERVICE DEFAULT_ROLE = BBC_INGEST        DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Connectors (RAW inserts).';
CREATE USER IF NOT EXISTS BBC_ENGINE_SVC TYPE = SERVICE DEFAULT_ROLE = BBC_ENGINE        DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Engine worker and dispatcher.';
CREATE USER IF NOT EXISTS BBC_AGENT_SVC  TYPE = SERVICE DEFAULT_ROLE = BBC_AGENT_RUNTIME DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Invokes Cortex Agents; agent tools only.';

CREATE USER IF NOT EXISTS BBC_DEMO_QUALITY  TYPE = PERSON DEFAULT_ROLE = BBC_QUALITY_MGR      DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Demo persona: quality & operations manager.';
CREATE USER IF NOT EXISTS BBC_DEMO_SALES    TYPE = PERSON DEFAULT_ROLE = BBC_SALES_MGR        DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Demo persona: sales manager.';
CREATE USER IF NOT EXISTS BBC_DEMO_FINANCE  TYPE = PERSON DEFAULT_ROLE = BBC_FINANCE_MGR      DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Demo persona: finance manager.';
CREATE USER IF NOT EXISTS BBC_DEMO_AUDITOR  TYPE = PERSON DEFAULT_ROLE = BBC_AUDITOR          DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Demo persona: auditor.';
CREATE USER IF NOT EXISTS BBC_DEMO_GOVADMIN TYPE = PERSON DEFAULT_ROLE = BBC_GOVERNANCE_ADMIN DEFAULT_WAREHOUSE = BBC_APP_WH COMMENT = 'Demo persona: governance administrator.';

GRANT ROLE BBC_INGEST           TO USER BBC_INGEST_SVC;
GRANT ROLE BBC_ENGINE           TO USER BBC_ENGINE_SVC;
GRANT ROLE BBC_AGENT_RUNTIME    TO USER BBC_AGENT_SVC;
GRANT ROLE BBC_QUALITY_MGR      TO USER BBC_DEMO_QUALITY;
GRANT ROLE BBC_SALES_MGR        TO USER BBC_DEMO_SALES;
GRANT ROLE BBC_FINANCE_MGR      TO USER BBC_DEMO_FINANCE;
GRANT ROLE BBC_AUDITOR          TO USER BBC_DEMO_AUDITOR;
GRANT ROLE BBC_GOVERNANCE_ADMIN TO USER BBC_DEMO_GOVADMIN;

ALTER USER BBC_INGEST_SVC    SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_ENGINE_SVC    SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_AGENT_SVC     SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_DEMO_QUALITY  SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_DEMO_SALES    SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_DEMO_FINANCE  SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_DEMO_AUDITOR  SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
ALTER USER BBC_DEMO_GOVADMIN SET AUTHENTICATION POLICY BBC_OS.GOV.BBC_PAT_ONLY;
