-- =============================================================================
-- BlueberryChain OS - WP2: hash-chained audit ledger
-- Hashing rules: python/bbc_toolkit/src/bbc_toolkit/ledger.py (single definition).
-- Only owner's-rights procedures append (via bbc_toolkit.snow.ledger_append);
-- no runtime role has INSERT, UPDATE or DELETE on these tables.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.LEDGER;

CREATE TABLE IF NOT EXISTS ENTRIES (
  seq           NUMBER(38,0)  NOT NULL,
  ts            STRING        NOT NULL COMMENT 'ISO-8601 UTC string that was hashed',
  ts_tz         TIMESTAMP_TZ  NOT NULL,
  entry_type    STRING        NOT NULL,
  case_id       STRING,
  actor         STRING        NOT NULL,
  record_ref    STRING        NOT NULL,
  payload       VARIANT       NOT NULL COMMENT 'Stored in canonical form, so re-hashing is stable',
  payload_hash  STRING        NOT NULL,
  prev_hash     STRING        NOT NULL,
  entry_hash    STRING        NOT NULL,
  CONSTRAINT pk_entries PRIMARY KEY (seq)
) COMMENT = 'Append-only hash chain of every lifecycle record, policy activation and reference change.';

CREATE TABLE IF NOT EXISTS HEAD (
  id         NUMBER(1,0)   NOT NULL,
  last_seq   NUMBER(38,0)  NOT NULL,
  last_hash  STRING        NOT NULL,
  CONSTRAINT pk_head PRIMARY KEY (id)
) COMMENT = 'Single row. Updating it inside the append transaction serializes concurrent appenders (spike S10).';

INSERT INTO HEAD (id, last_seq, last_hash)
SELECT 1, 0, REPEAT('0', 64)
WHERE NOT EXISTS (SELECT 1 FROM HEAD WHERE id = 1);
