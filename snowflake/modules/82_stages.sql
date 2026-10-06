-- =============================================================================
-- BlueberryChain OS - WP6b: the deterministic stage procedures and the engine API.
--   OPEN -> BUILD_ASSESSMENT -> ASSESSED -> ROUTE -> FINDING_RECORDED | FORENSICS_PENDING
--   -> GENERATE_AND_SCORE_OPTIONS -> OPTIONS_SCORED -> ROUTE -> RECOMMENDED | STRATEGY_PENDING
--   -> (audit gate) AUDITED -> EVALUATE_POLICY -> PENDING_APPROVAL | AUTO_APPROVED | DENIED
-- Each stage is one transaction: its record, the checked case transition and its ledger entry.
-- Handlers: bbc_toolkit.stage_procs (pure logic bbc_toolkit.stages, parity-tested against the
-- reference pack builder in python/blueberrychain/tests/test_stage_pack.py). The engine
-- (bbc_engine, pure Python) computes every number from the sealed pack.
-- Prerequisites: 80_decision_store.sql, 70_semantic_view.sql; `uv run bbc deploy python`.
-- RUNTIME_VERSION follows spike S4. Procedure clause order: COMMENT before EXECUTE AS.
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;

-- Internal stages: no runtime role has USAGE; the engine reaches them through API.ADVANCE_CASE.
CREATE OR REPLACE PROCEDURE BBC_OS.DECISION.BUILD_ASSESSMENT(CASE_ID STRING, DECISION_POINT STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.stage_procs.proc_build_assessment'
  COMMENT = 'Seal the evidence pack (canonical metrics via SEM.EXCURSION_RECOVERY) at the case data watermark; OPEN -> ASSESSED (ledgered).'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.DECISION.ROUTE(CASE_ID STRING, DECISION_POINT STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.stage_procs.proc_route'
  COMMENT = 'GOV.ROUTER_RULES: ASSESSED -> deterministic attribution or Forensics; OPTIONS_SCORED -> rule recommendation (re-evaluation must reproduce the stored options) or the Recovery Strategist.'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.DECISION.GENERATE_AND_SCORE_OPTIONS(CASE_ID STRING, DECISION_POINT STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.stage_procs.proc_generate_and_score_options'
  COMMENT = 'bbc_engine over the sealed pack: options (default + fallback always), eliminations, seeded outcomes, ranking, value at risk; FINDING_RECORDED -> OPTIONS_SCORED (ledgered).'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.DECISION.EVALUATE_POLICY(REC_ID STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.stage_procs.proc_evaluate_policy'
  COMMENT = 'Decision rights + autonomy thresholds of the ACTIVE policy for every action of the chosen bundle; requests one approval per required role; AUDITED -> PENDING_APPROVAL | AUTO_APPROVED | DENIED | SHADOW_RECORDED.'
  EXECUTE AS OWNER;

-- Engine API (BBC_ENGINE only).
CREATE OR REPLACE PROCEDURE BBC_OS.API.ADVANCE_CASE(CASE_ID STRING, EXPECTED_STATE STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.stage_procs.proc_advance_case'
  COMMENT = 'Run the deterministic stages until the case waits for a person, an agent or the gateway. A stale EXPECTED_STATE changes nothing (returns STALE).'
  EXECUTE AS OWNER;

CREATE OR REPLACE PROCEDURE BBC_OS.API.CLAIM_WORK(WORKER_ID STRING, LEASE_S NUMBER)
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'jsonschema')
  IMPORTS = ('@BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip',
             '@BBC_OS.GOV.CODE/bbc_engine/0.1.0/bbc_engine-0.1.0.zip')
  HANDLER = 'bbc_toolkit.stage_procs.proc_claim_work'
  COMMENT = 'Lease the oldest case that needs a step and say what it needs (ADVANCE, an agent, or execution).'
  EXECUTE AS OWNER;

GRANT USAGE ON SCHEMA BBC_OS.API TO ROLE BBC_ENGINE;
GRANT USAGE ON PROCEDURE BBC_OS.API.ADVANCE_CASE(STRING, STRING) TO ROLE BBC_ENGINE;
GRANT USAGE ON PROCEDURE BBC_OS.API.CLAIM_WORK(STRING, NUMBER)   TO ROLE BBC_ENGINE;

-- One row per recommendation, with what the decision metrics need (SEM.EXCURSION_RECOVERY).
-- Clocks: detected_at / onset_at are event time; opened_at / decided_at / approval times are
-- wall clock. Each metric compares times on the same clock.
CREATE OR REPLACE VIEW BBC_OS.DECISION.V_DECISIONS
  COMMENT = 'Decisions: who decided (RULE / AGENT / HUMAN / FALLBACK), the chosen and do-nothing values, the governance verdict and approval latency.'
AS
WITH planned AS (
  SELECT p.pack_id, SUM(l.value:planned_value_usd::NUMBER(14,2)) AS planned_value_usd
  FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS p, LATERAL FLATTEN(INPUT => p.pack:lots) l
  GROUP BY p.pack_id
),
approvals AS (
  SELECT rec_id,
         COUNT(*)                                                         AS approvals_requested,
         COUNT_IF(status = 'APPROVED')                                    AS approvals_approved,
         COUNT_IF(status = 'ALTERNATIVE_CHOSEN')                          AS alternatives_chosen,
         MAX(IFF(decided_at IS NOT NULL,
                 DATEDIFF('second', requested_at, decided_at) / 60, NULL)) AS approval_latency_min
  FROM BBC_OS.DECISION.APPROVALS GROUP BY rec_id
)
SELECT
  r.rec_id, r.case_id, r.decision_point, r.option_id, r.decided_by, r.decider_id, r.status,
  r.audit_status, r.created_at AS decided_at,
  c.opened_at, c.onset_at, c.detected_at, c.state AS case_state, c.value_at_risk_usd,
  o.pack_id, o.option_key, o.expected_nrv_usd AS predicted_nrv_usd, o.risk_adjusted_usd,
  d.expected_nrv_usd AS default_counterfactual_usd,
  pl.planned_value_usd,
  e.eval_id, e.outcome AS policy_outcome, e.autonomy_level, e.policy_version,
  COALESCE(a.approvals_requested, 0) AS approvals_requested,
  COALESCE(a.approvals_approved, 0)  AS approvals_approved,
  COALESCE(a.alternatives_chosen, 0) AS alternatives_chosen,
  a.approval_latency_min,
  DATEDIFF('second', c.onset_at, c.detected_at) / 60   AS time_to_detect_min,
  DATEDIFF('second', c.opened_at, r.created_at) / 60   AS time_to_decision_min
FROM BBC_OS.DECISION.RECOMMENDATIONS r
JOIN BBC_OS.DECISION.CASES c   ON c.case_id = r.case_id
JOIN BBC_OS.DECISION.OPTIONS o ON o.option_id = r.option_id
LEFT JOIN BBC_OS.DECISION.OPTIONS d
  ON d.case_id = o.case_id AND d.pack_id = o.pack_id AND d.is_default
LEFT JOIN planned pl ON pl.pack_id = o.pack_id
LEFT JOIN BBC_OS.DECISION.POLICY_EVALUATIONS e ON e.rec_id = r.rec_id
LEFT JOIN approvals a ON a.rec_id = r.rec_id;

GRANT SELECT ON VIEW BBC_OS.DECISION.V_DECISIONS TO ROLE BBC_AUDITOR;
