-- =============================================================================
-- BlueberryChain OS - WP6a: the decision store (schema DECISION; CASE in the plan, ADR-0007)
-- and the sealed evidence packs.
--
-- Each lifecycle record keeps its contract document whole (VARIANT, validated by the
-- writing procedure against contracts/schemas/*.json) plus the key columns that joins,
-- the inbox and the semantic view need. The ledger holds the hashed copy of every record.
--
-- Written only by owner's-rights procedures (OPEN_CASES here; the stage procedures,
-- MUTATE and the API in WP6b / WP7). No runtime role has INSERT, UPDATE or DELETE.
-- Money NUMBER(14,2), kg NUMBER(14,3), times TIMESTAMP_TZ.
-- PRIMARY KEY / UNIQUE are declarative in Snowflake (not enforced): the writing procedures
-- enforce them under the gateway lock, and snowflake/tests/05_case_store.sql checks them.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.DECISION;

-- ---------------------------------------------------------------------------- the case
CREATE TABLE IF NOT EXISTS CASES (
  case_id                   STRING        NOT NULL,
  decision_point            STRING        NOT NULL COMMENT 'D1 recovery | D2 settlement',
  state                     STRING        NOT NULL COMMENT 'contracts/schemas/common.json case_state',
  state_version             NUMBER(10,0)  NOT NULL DEFAULT 1 COMMENT 'Bumped on every transition; ADVANCE_CASE checks it',
  severity                  STRING        NOT NULL COMMENT 'LOW | MEDIUM | HIGH by pulp excess at detection (inbox order only)',
  episode_key               STRING        NOT NULL COMMENT 'The shipment, or lot@site off a shipment: one open case per episode',
  shipment_id               STRING,
  onset_at                  TIMESTAMP_TZ  NOT NULL COMMENT 'Start of the breach run that opened the case',
  detected_at               TIMESTAMP_TZ  NOT NULL COMMENT 'Last reading when the rule first held',
  last_detected_at          TIMESTAMP_TZ  NOT NULL,
  opened_at                 TIMESTAMP_TZ  NOT NULL,
  opened_by                 STRING        NOT NULL,
  holder_party_id_at_onset  STRING,
  holder_type_at_onset      STRING,
  detection                 VARIANT       NOT NULL COMMENT 'Rule inputs and per-lot facts at opening (= the CASE_OPENED ledger payload)',
  policy_version            STRING        NOT NULL COMMENT 'Policy whose parameters opened the case',
  deadline_ts               TIMESTAMP_TZ  COMMENT 'Set by BUILD_ASSESSMENT: when the safe fallback runs',
  value_at_risk_usd         NUMBER(14,2)  COMMENT 'Set by GENERATE_AND_SCORE_OPTIONS: planned value - E[NRV] of doing nothing',
  current_pack_id           STRING,
  current_rec_id            STRING,
  current_brief_hash        STRING,
  needs_reassessment        BOOLEAN       NOT NULL DEFAULT FALSE,
  lease_owner               STRING        COMMENT 'Engine worker holding the case (API.CLAIM_WORK)',
  lease_until               TIMESTAMP_TZ,
  provenance                STRING        NOT NULL DEFAULT 'LIVE' COMMENT 'LIVE | SIMULATION_BACKFILL',
  updated_at                TIMESTAMP_TZ  NOT NULL,
  CONSTRAINT pk_cases PRIMARY KEY (case_id)
) COMMENT = 'The Recovery Case: one excursion episode and where it is in the lifecycle.';

CREATE TABLE IF NOT EXISTS CASE_LOTS (
  case_id                   STRING        NOT NULL,
  lot_id                    STRING        NOT NULL,
  added_at                  TIMESTAMP_TZ  NOT NULL,
  onset_at                  TIMESTAMP_TZ  NOT NULL,
  detected_at               TIMESTAMP_TZ  NOT NULL,
  last_detected_at          TIMESTAMP_TZ  NOT NULL,
  breach_min_at_detection   NUMBER(10,2)  NOT NULL,
  max_pulp_c                NUMBER(5,2),
  holder_party_id_at_onset  STRING,
  assessment                VARIANT       COMMENT 'Frozen per-lot values of the latest pack (BUILD_ASSESSMENT)',
  CONSTRAINT pk_case_lots PRIMARY KEY (case_id, lot_id)
) COMMENT = 'The lots in a case: the grain of value at risk. A lot is in at most one open case.';

-- ------------------------------------------------------------------ lifecycle records
CREATE TABLE IF NOT EXISTS CAUSATION_FINDINGS (
  finding_id      STRING        NOT NULL,
  case_id         STRING        NOT NULL,
  decision_point  STRING        NOT NULL,
  revision        NUMBER(10,0)  NOT NULL,
  pack_id         STRING        NOT NULL,
  decider_kind    STRING        NOT NULL COMMENT 'AGENT (Excursion Forensics) | RULE (deterministic attribution)',
  run_id          STRING        COMMENT 'The agent run that submitted it',
  status          STRING        NOT NULL COMMENT 'ACCEPTED | REJECTED | SUPERSEDED',
  unadjudicated   BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'Deterministic fallback; claims stay DEFERRED',
  confidence      STRING,
  finding         VARIANT       NOT NULL COMMENT 'contracts/schemas/finding.json',
  finding_hash    STRING        NOT NULL,
  validation      VARIANT       COMMENT 'Errors and server adjustments (e.g. confidence capped by coverage)',
  created_at      TIMESTAMP_TZ  NOT NULL,
  created_by      STRING        NOT NULL,
  ledger_seq      NUMBER(38,0),
  CONSTRAINT pk_causation_findings PRIMARY KEY (finding_id)
) COMMENT = 'What caused the excursion and whom the evidence holds responsible (append-only revisions).';

CREATE TABLE IF NOT EXISTS OPTIONS (
  option_id          STRING        NOT NULL,
  case_id            STRING        NOT NULL,
  decision_point     STRING        NOT NULL,
  option_set_rev     NUMBER(10,0)  NOT NULL,
  pack_id            STRING        NOT NULL,
  option_key         STRING        NOT NULL COMMENT 'Engine signature, e.g. REROUTE:SITE-BAYLINE-SAC:PLAN (seed and identity across revisions)',
  origin             STRING        NOT NULL COMMENT 'GENERATOR | AGENT_VARIANT',
  parent_option_id   STRING,
  is_default         BOOLEAN       NOT NULL,
  is_fallback        BOOLEAN       NOT NULL,
  feasible           BOOLEAN       NOT NULL,
  score_rank         NUMBER(5,0)   COMMENT 'NULL when eliminated',
  risk_adjusted_usd  NUMBER(14,2)  NOT NULL,
  expected_nrv_usd   NUMBER(14,2)  NOT NULL,
  expires_at         TIMESTAMP_TZ  NOT NULL,
  engine_version     STRING        NOT NULL,
  seed               NUMBER(38,0)  NOT NULL,
  option             VARIANT       NOT NULL COMMENT 'contracts/schemas/option.json',
  option_hash        STRING        NOT NULL,
  created_at         TIMESTAMP_TZ  NOT NULL,
  ledger_seq         NUMBER(38,0),
  CONSTRAINT pk_options PRIMARY KEY (option_id)
) COMMENT = 'Scored option bundles. Mutually exclusive alternatives: never aggregated.';

CREATE TABLE IF NOT EXISTS RECOMMENDATIONS (
  rec_id              STRING        NOT NULL,
  case_id             STRING        NOT NULL,
  decision_point      STRING        NOT NULL,
  option_id           STRING        NOT NULL,
  decided_by          STRING        NOT NULL COMMENT 'RULE | AGENT | HUMAN | FALLBACK',
  decider_id          STRING        NOT NULL COMMENT 'rule@version, agent@spec version or user',
  run_id              STRING,
  escalation_reasons  ARRAY,
  brief               VARIANT       NOT NULL COMMENT 'contracts/schemas/brief.json, sealed (approvals bind to brief_hash)',
  brief_hash          STRING        NOT NULL,
  submission          VARIANT       COMMENT 'Agent submission: recommendation.json or claim_recommendation.json',
  status              STRING        NOT NULL COMMENT 'ACTIVE | SUPERSEDED | REJECTED',
  audit_status        STRING        NOT NULL COMMENT 'NOT_REQUIRED | PENDING | PASS | FAIL | UNVERIFIED',
  audit_verdict       VARIANT       COMMENT 'contracts/schemas/audit_verdict.json',
  created_at          TIMESTAMP_TZ  NOT NULL,
  ledger_seq          NUMBER(38,0),
  CONSTRAINT pk_recommendations PRIMARY KEY (rec_id)
) COMMENT = 'The chosen option, who chose it and the sealed Decision Brief it rests on.';

CREATE TABLE IF NOT EXISTS POLICY_EVALUATIONS (
  eval_id            STRING        NOT NULL,
  case_id            STRING        NOT NULL,
  rec_id             STRING        NOT NULL,
  policy_version     STRING        NOT NULL,
  outcome            STRING        NOT NULL COMMENT 'AUTO | APPROVE | HUMAN_INITIATE | OBSERVE_ONLY | DENY (bbc_engine.autonomy)',
  autonomy_level     NUMBER(1,0)   NOT NULL,
  required_roles     ARRAY,
  dual_approval      BOOLEAN       NOT NULL DEFAULT FALSE,
  shadow             BOOLEAN       NOT NULL DEFAULT FALSE,
  matched_rules      ARRAY,
  value_at_risk_usd  NUMBER(14,2),
  evaluation         VARIANT       NOT NULL COMMENT 'Per action: authorization, dimension bands, reasons',
  created_at         TIMESTAMP_TZ  NOT NULL,
  ledger_seq         NUMBER(38,0),
  CONSTRAINT pk_policy_evaluations PRIMARY KEY (eval_id)
) COMMENT = 'Decision rights + autonomy level for a recommendation, stamped with the policy version.';

CREATE TABLE IF NOT EXISTS APPROVALS (
  approval_id            STRING        NOT NULL,
  case_id                STRING        NOT NULL,
  eval_id                STRING        NOT NULL,
  rec_id                 STRING        NOT NULL,
  required_role          STRING        NOT NULL,
  status                 STRING        NOT NULL COMMENT 'REQUESTED | APPROVED | ALTERNATIVE_CHOSEN | REJECTED | EXPIRED | STALE',
  requested_at           TIMESTAMP_TZ  NOT NULL,
  due_at                 TIMESTAMP_TZ  NOT NULL COMMENT 'Deadline minus dispatch lead: after it the fallback runs',
  brief_hash_at_request  STRING        NOT NULL,
  pack_hash_at_request   STRING        NOT NULL,
  proposer               STRING        NOT NULL COMMENT 'May never approve (proposer != approver)',
  decided_by             STRING        COMMENT 'CURRENT_USER() inside DECIDE_APPROVAL',
  decided_role           STRING,
  decided_at             TIMESTAMP_TZ,
  chosen_option_id       STRING,
  reason                 STRING,
  freshness              VARIANT       COMMENT 'Hashes and drift re-checked at decision time',
  ledger_seq             NUMBER(38,0),
  CONSTRAINT pk_approvals PRIMARY KEY (approval_id)
) COMMENT = 'One row per required role: request, verdict and the evidence it was given on.';

CREATE TABLE IF NOT EXISTS EXECUTION_PLANS (
  plan_id     STRING        NOT NULL,
  case_id     STRING        NOT NULL,
  rec_id      STRING        NOT NULL,
  atomicity   STRING        NOT NULL COMMENT 'ALL_OR_NOTHING | BEST_EFFORT',
  status      STRING        NOT NULL COMMENT 'PLANNED | EXECUTING | DONE | PARTIAL | COMPENSATING | COMPENSATED | FAILED',
  steps       VARIANT       NOT NULL COMMENT 'Ordered steps: protective first, irreversible last',
  created_at  TIMESTAMP_TZ  NOT NULL,
  updated_at  TIMESTAMP_TZ  NOT NULL,
  CONSTRAINT pk_execution_plans PRIMARY KEY (plan_id)
) COMMENT = 'How a chosen bundle executes, step by step, and what to undo if a step fails.';

CREATE TABLE IF NOT EXISTS MUTATIONS (
  mutation_id         STRING        NOT NULL,
  case_id             STRING        NOT NULL,
  decision_point      STRING        NOT NULL,
  rec_id              STRING,
  plan_id             STRING,
  step_seq            NUMBER(5,0),
  action_type         STRING        NOT NULL,
  target_system       STRING        NOT NULL,
  target_entity       STRING        NOT NULL COMMENT 'Gateway rejects a second in-flight mutation on it (CONFLICT)',
  idempotency_key     STRING        NOT NULL COMMENT 'hash(case, dp, option, action, target, brief_hash): a duplicate returns the existing row',
  status              STRING        NOT NULL COMMENT 'contracts/schemas/common.json mutation_status',
  autonomy_level      NUMBER(1,0)   NOT NULL,
  policy_eval_id      STRING        NOT NULL,
  approval_ids        ARRAY,
  authorization_hash  STRING        NOT NULL COMMENT 'V_DISPATCHABLE recomputes it; a row edited outside the gateway never dispatches',
  intent              VARIANT       NOT NULL COMMENT 'contracts/schemas/mutation_intent.json',
  record              VARIANT       NOT NULL COMMENT 'contracts/schemas/mutation_record.json (latest)',
  external_ref        STRING,
  attempts            NUMBER(5,0)   NOT NULL DEFAULT 0,
  lease_owner         STRING        COMMENT 'Dispatcher holding the row (API.NEXT_ACTIONS)',
  lease_until         TIMESTAMP_TZ,
  compensation_of     STRING,
  compensated_by      STRING,
  created_at          TIMESTAMP_TZ  NOT NULL,
  updated_at          TIMESTAMP_TZ  NOT NULL,
  CONSTRAINT pk_mutations PRIMARY KEY (mutation_id),
  CONSTRAINT uq_mutations_key UNIQUE (idempotency_key)
) COMMENT = 'The outbox: every governed change, inside or outside Snowflake, written only by DECISION.MUTATE.';

CREATE TABLE IF NOT EXISTS CLAIMS (
  claim_id               STRING        NOT NULL,
  case_id                STRING        NOT NULL,
  counterparty_party_id  STRING        NOT NULL,
  basis                  STRING        NOT NULL COMMENT 'CARRIER_TEMPERATURE | GROWER_PRECOOL | GROWER_QUALITY',
  status                 STRING        NOT NULL COMMENT 'NOTICE_SENT | FILED | RESPONDED | SETTLED | DENIED | ABSORBED | WITHDRAWN',
  amount_usd             NUMBER(14,2)  COMMENT 'Only from a calculator variant (never free text)',
  paid_usd               NUMBER(14,2),
  notice_sent_at         TIMESTAMP_TZ,
  filed_at               TIMESTAMP_TZ,
  filing_due_at          TIMESTAMP_TZ  COMMENT 'Contract claim window; the deadline guard reads it',
  variant_option_id      STRING,
  evidence_pack_id       STRING,
  letter                 VARIANT       COMMENT 'Audited letter text and its versions',
  updated_at             TIMESTAMP_TZ  NOT NULL,
  CONSTRAINT pk_claims PRIMARY KEY (claim_id)
) COMMENT = 'Financial recovery: notice, filing, counterparty response, settlement.';

CREATE TABLE IF NOT EXISTS OUTCOMES (
  case_id                       STRING        NOT NULL,
  lot_id                        STRING        NOT NULL,
  outcome_status                STRING        NOT NULL COMMENT 'OBSERVED | UNKNOWN | PROVISIONAL',
  accepted_at_receipt           BOOLEAN,
  observed                      VARIANT       COMMENT 'Receipt QC, actual shelf life, sale value, claim result',
  predicted                     VARIANT       COMMENT 'The chosen option as scored',
  default_counterfactual        VARIANT       COMMENT 'The do-nothing option as scored (ex ante)',
  realized_nrv_usd              NUMBER(14,2),
  predicted_nrv_usd             NUMBER(14,2),
  sl_prediction_error_days      NUMBER(8,3),
  computed_at                   TIMESTAMP_TZ  NOT NULL,
  CONSTRAINT pk_outcomes PRIMARY KEY (case_id, lot_id)
) COMMENT = 'What really happened, against what was predicted and what doing nothing would have given.';

-- ------------------------------------------------------------------- agents and tools
CREATE TABLE IF NOT EXISTS AGENT_RUNS (
  run_id                  STRING        NOT NULL,
  case_id                 STRING        NOT NULL,
  decision_point          STRING        NOT NULL,
  agent                   STRING        NOT NULL,
  provider                STRING        NOT NULL,
  model                   STRING        NOT NULL,
  spec_version            STRING        NOT NULL,
  reference_card_version  STRING,
  tool_allowlist          ARRAY         NOT NULL,
  call_budget             NUMBER(5,0)   NOT NULL,
  calls_used              NUMBER(5,0)   NOT NULL DEFAULT 0,
  expires_at              TIMESTAMP_TZ  NOT NULL,
  status                  STRING        NOT NULL COMMENT 'STARTED | COMPLETED | FAILED | EXPIRED',
  input_hash              STRING,
  trace                   VARIANT       COMMENT 'Event trace recorded by END_AGENT_RUN',
  latency_ms              NUMBER(10,0),
  tokens                  VARIANT,
  started_by              STRING        NOT NULL,
  started_at              TIMESTAMP_TZ  NOT NULL,
  ended_at                TIMESTAMP_TZ,
  CONSTRAINT pk_agent_runs PRIMARY KEY (run_id)
) COMMENT = 'Each agent invocation: the case-scoped capability (run_id) every tool checks.';

CREATE TABLE IF NOT EXISTS TOOL_CALLS (
  run_id        STRING        NOT NULL,
  call_seq      NUMBER(5,0)   NOT NULL,
  tool          STRING        NOT NULL,
  tool_version  STRING        NOT NULL,
  args_hash     STRING        NOT NULL,
  result_hash   STRING        NOT NULL,
  evidence_ids  ARRAY         COMMENT 'What this call showed the agent; submissions may cite only these',
  status        STRING        NOT NULL,
  latency_ms    NUMBER(10,0),
  called_at     TIMESTAMP_TZ  NOT NULL,
  CONSTRAINT pk_tool_calls PRIMARY KEY (run_id, call_seq)
) COMMENT = 'One row per tool call, written by the tool itself (an agent cannot skip it).';

-- ----------------------------------------------------------------------- coordination
CREATE TABLE IF NOT EXISTS GATEWAY_LOCK (
  id       NUMBER(1,0)   NOT NULL,
  held_by  STRING,
  held_at  TIMESTAMP_TZ,
  CONSTRAINT pk_gateway_lock PRIMARY KEY (id)
) COMMENT = 'Single row. Updating it first serializes MUTATE and OPEN_CASES (like LEDGER.HEAD, spike S10).';

INSERT INTO GATEWAY_LOCK (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM GATEWAY_LOCK WHERE id = 1);

CREATE TABLE IF NOT EXISTS ID_COUNTERS (
  kind        STRING        NOT NULL,
  next_value  NUMBER(38,0)  NOT NULL,
  CONSTRAINT pk_id_counters PRIMARY KEY (kind)
) COMMENT = 'Contiguous id blocks (bbc_toolkit.snow.allocate_ids): the engine numbers a whole option set at once.';

INSERT INTO ID_COUNTERS (kind, next_value)
SELECT k.kind, 1
FROM (SELECT column1 AS kind FROM VALUES ('CASE'), ('PACK'), ('OPTION'), ('REC'), ('FINDING'), ('EVAL'),
                                         ('APPROVAL'), ('MUTATION'), ('PLAN'), ('CLAIM'), ('RUN')) k
WHERE NOT EXISTS (SELECT 1 FROM ID_COUNTERS c WHERE c.kind = k.kind);

CREATE TABLE IF NOT EXISTS DETECTION_LOG (
  run_id            STRING        NOT NULL,
  lot_id            STRING        NOT NULL,
  holder_party_id   STRING,
  bucket_start_utc  TIMESTAMP_NTZ NOT NULL,
  breach_min        NUMBER(10,2),
  logged_at         TIMESTAMP_TZ  NOT NULL DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Bucket changes each detection run consumed from the stream (what it looked at).';

-- ------------------------------------------------------------------- evidence packs
USE SCHEMA BBC_OS.EVIDENCE;

CREATE TABLE IF NOT EXISTS EVIDENCE_PACKS (
  pack_id         STRING        NOT NULL,
  case_id         STRING        NOT NULL,
  decision_point  STRING        NOT NULL,
  revision        NUMBER(10,0)  NOT NULL,
  as_of           TIMESTAMP_TZ  NOT NULL COMMENT 'Replay rebuilds from RAW with received_at <= as_of',
  sealed_at       TIMESTAMP_TZ  NOT NULL,
  content_hash    STRING        NOT NULL COMMENT 'Canonical hash of the pack without content_hash',
  param_versions  VARIANT       NOT NULL,
  pack            VARIANT       NOT NULL COMMENT 'contracts/schemas/evidence_pack.json',
  built_by        STRING        NOT NULL,
  ledger_seq      NUMBER(38,0),
  CONSTRAINT pk_evidence_packs PRIMARY KEY (pack_id),
  CONSTRAINT uq_evidence_packs_rev UNIQUE (case_id, decision_point, revision)
) COMMENT = 'Sealed snapshot of every fact a decision used. Insert-only.';

-- ------------------------------------------------------------------------- grants
-- Auditors read the whole decision record; nobody but the owner writes it.
GRANT SELECT ON ALL TABLES IN SCHEMA BBC_OS.DECISION      TO ROLE BBC_AUDITOR;
GRANT SELECT ON TABLE BBC_OS.EVIDENCE.EVIDENCE_PACKS      TO ROLE BBC_AUDITOR;
