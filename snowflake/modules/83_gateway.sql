-- =============================================================================
-- BlueberryChain OS - WP7a: the Action Gateway. AUTO_APPROVED / APPROVED -> EXECUTE_PLAN
-- -> MUTATE (9 steps under the gateway lock) -> NEXT_ACTIONS (dispatcher lease) ->
-- ACK_MUTATION (verify-after, plan progress, compensation) -> EXECUTED | COMPENSATED.
-- Approvals: API.DECIDE_APPROVAL (role read from the caller's grants; proposer != approver).
-- Deadlines: DECISION.ENFORCE_DEADLINES (expired approvals -> FALLBACK). Kill switch:
-- API.EMERGENCY_STOP (dispatch resumes only when a policy version is activated).
-- Handlers: bbc_toolkit.gateway_procs (pure logic bbc_toolkit.gateway).
-- Prerequisites: 82_stages.sql; `uv run bbc deploy python`.
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;

CREATE TABLE IF NOT EXISTS BBC_OS.GOV.EMERGENCY_STOPS (
  stopped_at      TIMESTAMP_TZ NOT NULL,
  stopped_by      STRING       NOT NULL,
  reason          STRING       NOT NULL,
  policy_version  STRING,
  ledger_seq      NUMBER(38,0) NOT NULL
) COMMENT = 'Kill switch: dispatch is stopped while the latest stop is newer than the latest policy activation.';

-- A mutation dispatches only if its authorization hash still matches its intent, evaluation
-- and approvals (a row edited outside the gateway never dispatches).
CREATE OR REPLACE VIEW BBC_OS.API.V_DISPATCHABLE
  COMMENT = 'AUTHORIZED mutations whose authorization_hash recomputes.'
AS
SELECT m.mutation_id, m.case_id, m.intent, m.attempts, m.plan_id, m.step_seq, m.created_at,
       m.lease_until
FROM BBC_OS.DECISION.MUTATIONS m
WHERE m.status = 'AUTHORIZED'
  AND m.authorization_hash = BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_CONSTRUCT(
          'intent', m.intent, 'policy_eval_id', m.policy_eval_id,
          'approval_ids', ARRAY_SORT(COALESCE(m.approval_ids, ARRAY_CONSTRUCT()))));

CREATE OR REPLACE PROCEDURE BBC_OS.DECISION.MUTATE(INTENT VARIANT)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_mutate'
  COMMENT = 'Internal: the only writer of DECISION.MUTATIONS (schema, idempotency, conflict, authorization, preconditions, ledger).'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.EXECUTE_PLAN(CASE_ID STRING, REC_ID STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_execute_plan'
  COMMENT = 'Engine only: approved recommendation -> execution plan -> one MUTATE per step; case EXECUTING.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.NEXT_ACTIONS(DISPATCHER_ID STRING, MAX_ACTIONS NUMBER, LEASE_S NUMBER)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_next_actions'
  COMMENT = 'Dispatcher: lease the next dispatchable step of each plan (AUTHORIZED -> PREPARED). Empty while an emergency stop is in force.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.ACK_MUTATION(MUTATION_ID STRING, ATTEMPT NUMBER, ACK VARIANT)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_ack_mutation'
  COMMENT = 'Dispatcher: report the target system result; verify-after; plan progress; compensation on failure.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.DECIDE_APPROVAL(APPROVAL_ID STRING, VERDICT STRING, CHOSEN_OPTION_ID STRING, REASON STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_decide_approval'
  COMMENT = 'APPROVE | REJECT | CHOOSE_ALTERNATIVE by the required role (read from grants); the approver must not be the proposer.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.DECISION.ENFORCE_DEADLINES()
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_enforce_deadlines'
  COMMENT = 'Internal (task): approvals past their world-clock deadline expire; the case takes the pre-authorized FALLBACK.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.EMERGENCY_STOP(REASON STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.gateway_procs.proc_emergency_stop'
  COMMENT = 'Governance admin: stop all dispatch (ledgered) until a policy version is activated.'
  EXECUTE AS OWNER;

CREATE OR REPLACE TASK BBC_OS.DECISION.T_DEADLINES
  WAREHOUSE = BBC_APP_WH
  SCHEDULE = '1 MINUTE'
  COMMENT = 'Approval deadlines -> FALLBACK.'
AS
  CALL BBC_OS.DECISION.ENFORCE_DEADLINES();
ALTER TASK BBC_OS.DECISION.T_DEADLINES RESUME;

GRANT USAGE ON PROCEDURE BBC_OS.API.EXECUTE_PLAN(STRING, STRING)          TO ROLE BBC_ENGINE;
GRANT USAGE ON PROCEDURE BBC_OS.API.NEXT_ACTIONS(STRING, NUMBER, NUMBER)  TO ROLE BBC_ENGINE;
GRANT USAGE ON PROCEDURE BBC_OS.API.ACK_MUTATION(STRING, NUMBER, VARIANT) TO ROLE BBC_ENGINE;
GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_QUALITY_MGR;
GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_SALES_MGR;
GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_FINANCE_MGR;
GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_GOVERNANCE_ADMIN;
GRANT USAGE ON PROCEDURE BBC_OS.API.DECIDE_APPROVAL(STRING, STRING, STRING, STRING) TO ROLE BBC_QUALITY_MGR;
GRANT USAGE ON PROCEDURE BBC_OS.API.DECIDE_APPROVAL(STRING, STRING, STRING, STRING) TO ROLE BBC_SALES_MGR;
GRANT USAGE ON PROCEDURE BBC_OS.API.DECIDE_APPROVAL(STRING, STRING, STRING, STRING) TO ROLE BBC_FINANCE_MGR;
GRANT USAGE ON PROCEDURE BBC_OS.API.EMERGENCY_STOP(STRING) TO ROLE BBC_GOVERNANCE_ADMIN;
