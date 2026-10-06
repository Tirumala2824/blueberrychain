-- =============================================================================
-- BlueberryChain OS - WP2: versioned policy tables (GOV)
-- Contract: contracts/schemas/policy.json. Drafted by API.DRAFT_POLICY,
-- activated by API.ACTIVATE_POLICY (separation of duties: the drafter cannot
-- activate). Exactly one version is ACTIVE; activated versions are immutable.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.GOV;

CREATE TABLE IF NOT EXISTS POLICY_VERSIONS (
  policy_version     STRING        NOT NULL,
  status             STRING        NOT NULL COMMENT 'DRAFT | ACTIVE | RETIRED',
  document           VARIANT       NOT NULL COMMENT 'The full policy document, stored in canonical form',
  content_hash       STRING        NOT NULL,
  description        STRING,
  drafted_by         STRING        NOT NULL,
  drafted_at         TIMESTAMP_TZ  NOT NULL,
  activated_by       STRING,
  activated_at       TIMESTAMP_TZ,
  activation_reason  STRING,
  retired_at         TIMESTAMP_TZ,
  CONSTRAINT pk_policy_versions PRIMARY KEY (policy_version)
);

CREATE TABLE IF NOT EXISTS PARAMETERS (
  policy_version STRING NOT NULL, param_key STRING NOT NULL, param_value VARIANT NOT NULL,
  CONSTRAINT pk_parameters PRIMARY KEY (policy_version, param_key)
);

CREATE TABLE IF NOT EXISTS DECISION_RIGHTS (
  policy_version STRING NOT NULL, rule_id STRING NOT NULL, priority NUMBER(5,0) NOT NULL, conditions VARIANT NOT NULL,
  outcome STRING NOT NULL, required_roles ARRAY NOT NULL, note STRING,
  CONSTRAINT pk_decision_rights PRIMARY KEY (policy_version, rule_id)
);

CREATE TABLE IF NOT EXISTS ROUTER_RULES (
  policy_version STRING NOT NULL, trigger_code STRING NOT NULL, enabled BOOLEAN NOT NULL, target_agent STRING NOT NULL,
  params VARIANT,
  CONSTRAINT pk_router_rules PRIMARY KEY (policy_version, trigger_code)
);

CREATE TABLE IF NOT EXISTS HARD_LIMITS (
  policy_version STRING NOT NULL, limit_id STRING NOT NULL, product_id STRING NOT NULL, max_pulp_c NUMBER(5,2) NOT NULL,
  max_minutes_above NUMBER(6,0) NOT NULL, consequence STRING NOT NULL,
  CONSTRAINT pk_hard_limits PRIMARY KEY (policy_version, limit_id)
);

CREATE TABLE IF NOT EXISTS AUTONOMY_THRESHOLDS (
  policy_version STRING NOT NULL, dimension STRING NOT NULL, ordinal NUMBER(3,0) NOT NULL, metric STRING NOT NULL,
  l3_max VARIANT NOT NULL, l4_max VARIANT, beyond_l4 STRING, approver_roles ARRAY,
  CONSTRAINT pk_autonomy_thresholds PRIMARY KEY (policy_version, dimension, ordinal)
);

CREATE TABLE IF NOT EXISTS ACTION_TYPES (
  policy_version STRING NOT NULL, action_type STRING NOT NULL, target_system STRING NOT NULL,
  reversibility STRING NOT NULL, max_level NUMBER(1,0) NOT NULL, compensation STRING, preconditions ARRAY,
  CONSTRAINT pk_action_types PRIMARY KEY (policy_version, action_type)
);

CREATE TABLE IF NOT EXISTS MODEL_REGISTRY (
  policy_version STRING NOT NULL, agent STRING NOT NULL, provider STRING NOT NULL, model STRING NOT NULL,
  role STRING NOT NULL, data_classes ARRAY NOT NULL, must_differ_from_author BOOLEAN,
  CONSTRAINT pk_model_registry PRIMARY KEY (policy_version, agent, role)
);

CREATE TABLE IF NOT EXISTS METRIC_REGISTRY (
  policy_version STRING NOT NULL, name STRING NOT NULL, version STRING NOT NULL, canonical BOOLEAN NOT NULL,
  unit STRING NOT NULL, grain STRING NOT NULL, owner_role STRING NOT NULL, staleness_limit_min NUMBER(6,0),
  allowed_dimensions ARRAY, definition_hash STRING COMMENT 'From the policy document; = blueberrychain.semantic.definition_hashes of SEM.EXCURSION_RECOVERY',
  CONSTRAINT pk_metric_registry PRIMARY KEY (policy_version, name)
);

-- The one active policy version (NULL until the first activation).
CREATE OR REPLACE FUNCTION ACTIVE_POLICY_VERSION()
  RETURNS STRING
  AS $$ SELECT MAX(policy_version) FROM BBC_OS.GOV.POLICY_VERSIONS WHERE status = 'ACTIVE' $$;
