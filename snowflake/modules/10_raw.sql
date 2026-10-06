-- =============================================================================
-- BlueberryChain OS - WP2: RAW landing tables (append-only)
-- Contracts: contracts/schemas/raw/*.json. Connectors never write these tables
-- directly: the ingest procedures (WP3) MERGE on idempotency_key and commit the
-- connector cursor in the same transaction.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.RAW;

CREATE TABLE IF NOT EXISTS TELEMETRY (
  device_id        STRING        NOT NULL,
  reading_ts       TIMESTAMP_TZ  NOT NULL,
  interval_s       NUMBER(5,0)   NOT NULL,
  readings         VARIANT       NOT NULL COMMENT 'pulp_c, supply_air_c, return_air_c, setpoint_c, ambient_c, mode, door_open, alarms, lat, lon, battery_pct',
  idempotency_key  STRING        NOT NULL COMMENT 'canonical hash of {kind: TELEMETRY, device_id, reading_ts}',
  connector_id     STRING        NOT NULL,
  provenance       STRING        NOT NULL DEFAULT 'LIVE',
  received_at      TIMESTAMP_TZ  NOT NULL DEFAULT CURRENT_TIMESTAMP() COMMENT 'Replay filters on received_at <= as_of',
  CONSTRAINT pk_telemetry PRIMARY KEY (idempotency_key)
) COMMENT = 'One sensor reading (contracts/schemas/raw/telemetry_reading.json). Append-only.';

CREATE TABLE IF NOT EXISTS BUSINESS_EVENTS (
  source_system    STRING        NOT NULL,
  entity_type      STRING        NOT NULL,
  external_id      STRING        NOT NULL,
  event_ts         TIMESTAMP_TZ  NOT NULL COMMENT 'Business time of the record',
  payload          VARIANT       NOT NULL,
  idempotency_key  STRING        NOT NULL COMMENT 'canonical hash of {kind: BUSINESS_EVENT, source_system, entity_type, external_id, version}',
  connector_id     STRING        NOT NULL,
  provenance       STRING        NOT NULL DEFAULT 'LIVE',
  received_at      TIMESTAMP_TZ  NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_business_events PRIMARY KEY (idempotency_key)
) COMMENT = 'Every non-telemetry record (contracts/schemas/raw/business_event.json). Append-only.';

CREATE TABLE IF NOT EXISTS CONNECTOR_STATE (
  connector_id     STRING        NOT NULL,
  stream           STRING        NOT NULL,
  cursor_value     STRING,
  updated_at       TIMESTAMP_TZ  NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_connector_state PRIMARY KEY (connector_id, stream)
) COMMENT = 'Delta cursors; committed in the same transaction as the rows they cover.';

CREATE TABLE IF NOT EXISTS INGEST_ERRORS (
  connector_id     STRING        NOT NULL,
  received_at      TIMESTAMP_TZ  NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  target           STRING        NOT NULL COMMENT 'TELEMETRY or BUSINESS_EVENTS',
  payload          VARIANT,
  errors           VARIANT       NOT NULL
) COMMENT = 'Rejected rows (dead-letter). A data gap becomes an auditable fact.';
