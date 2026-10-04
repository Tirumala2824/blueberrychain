-- =====================================================================
-- BlueberryChain OS - 11 IoT Cold-Chain Ledger
--
-- Landing zone for the three modular CoCo skills in .cortex/skills:
--   1 ledger-integrity-validator  -> INTEGRITY_REJECTIONS
--   2 coldchain-anomaly-detector  -> ANOMALY_EVENTS
--   3 snowflake-audit-sync        -> VERIFIED_TELEMETRY, ATTESTATIONS, @ATTESTATION_STAGE
--
-- Every IoT logger signs each reading with Ed25519 and hash-chains it to
-- its previous reading. DEVICE_REGISTRY is the trust anchor: only keys
-- registered here are accepted. Re-runnable (IF NOT EXISTS everywhere).
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE WAREHOUSE BBC_WH;

CREATE SCHEMA IF NOT EXISTS BLUEBERRY_CHAIN.LEDGER
    COMMENT = 'Signed, hash-chained IoT cold-chain telemetry and attestations';
USE SCHEMA BLUEBERRY_CHAIN.LEDGER;

-- ---------------------------------------------------------------------
-- Trust anchor: one Ed25519 public key per IoT logger
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS DEVICE_REGISTRY (
    DEVICE_ID       VARCHAR(40)  NOT NULL PRIMARY KEY,
    REEFER_ID       VARCHAR(30)  NOT NULL,
    SHIPMENT_ID     VARCHAR(30)  NOT NULL,
    KEY_ALGO        VARCHAR(20)  DEFAULT 'ED25519',
    PUBLIC_KEY_HEX  VARCHAR(64)  NOT NULL,
    GENESIS_HASH    VARCHAR(64)  NOT NULL,
    STATUS          VARCHAR(20)  DEFAULT 'ACTIVE',
    REGISTERED_TS   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Registered IoT loggers. GENESIS_HASH is the prev_hash of each device''s first reading';

-- ---------------------------------------------------------------------
-- One row per pipeline run
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS PIPELINE_RUNS (
    RUN_ID            VARCHAR(40)  NOT NULL PRIMARY KEY,
    STARTED_TS        TIMESTAMP_NTZ,
    SYNCED_TS         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    SOURCE_FILES      NUMBER(6,0),
    RECORDS_IN        NUMBER(12,0),
    RECORDS_VERIFIED  NUMBER(12,0),
    RECORDS_REJECTED  NUMBER(12,0),
    ANOMALIES         NUMBER(8,0),
    STATUS            VARCHAR(20)
);

-- ---------------------------------------------------------------------
-- Ledger entries that passed every integrity rule
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS VERIFIED_TELEMETRY (
    RUN_ID        VARCHAR(40)  NOT NULL,
    EVENT_ID      VARCHAR(60)  NOT NULL,
    DEVICE_ID     VARCHAR(40)  NOT NULL,
    SHIPMENT_ID   VARCHAR(30)  NOT NULL,
    SEQ           NUMBER(10,0) NOT NULL,
    READING_TS    TIMESTAMP_NTZ NOT NULL,
    LAT           NUMBER(9,6),
    LON           NUMBER(9,6),
    PULP_TEMP_C   NUMBER(6,2),
    RETURN_AIR_C  NUMBER(6,2),
    DOOR_OPEN     BOOLEAN,
    PREV_HASH     VARCHAR(64)  NOT NULL,
    ENTRY_HASH    VARCHAR(64)  NOT NULL,
    SIGNATURE     VARCHAR(128) NOT NULL,
    VERIFIED_TS   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Signature- and chain-verified telemetry. Merkle root of ENTRY_HASH per run is in ATTESTATIONS';

-- ---------------------------------------------------------------------
-- Quarantined records and the rule that rejected them
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS INTEGRITY_REJECTIONS (
    RUN_ID       VARCHAR(40)  NOT NULL,
    EVENT_ID     VARCHAR(60),
    DEVICE_ID    VARCHAR(40),
    SHIPMENT_ID  VARCHAR(30),
    SEQ          NUMBER(10,0),
    RULE         VARCHAR(30)  NOT NULL,
    DETAIL       VARCHAR(500),
    RAW_RECORD   VARIANT
) COMMENT = 'RULE one of SCHEMA_INVALID, UNKNOWN_DEVICE, SHIPMENT_MISMATCH, HASH_MISMATCH, SIGNATURE_INVALID, REPLAY, CHAIN_GAP, CHAIN_BREAK';

-- ---------------------------------------------------------------------
-- Cold-chain anomalies found on verified data only
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ANOMALY_EVENTS (
    RUN_ID        VARCHAR(40)  NOT NULL,
    ANOMALY_ID    VARCHAR(60)  NOT NULL,
    SHIPMENT_ID   VARCHAR(30)  NOT NULL,
    DEVICE_ID     VARCHAR(40),
    ANOMALY_TYPE  VARCHAR(30)  NOT NULL,
    SEVERITY      VARCHAR(10)  NOT NULL,
    START_TS      TIMESTAMP_NTZ,
    END_TS        TIMESTAMP_NTZ,
    DURATION_MIN  NUMBER(8,1),
    EVIDENCE      VARIANT
) COMMENT = 'ANOMALY_TYPE one of TEMP_EXCURSION, DOOR_OPEN, GPS_JUMP, SENSOR_FLATLINE, STAT_OUTLIER';

-- ---------------------------------------------------------------------
-- Signed attestation per run
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ATTESTATIONS (
    RUN_ID            VARCHAR(40)  NOT NULL PRIMARY KEY,
    ATTESTATION_ID    VARCHAR(40)  NOT NULL,
    CREATED_TS        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    RECORDS_VERIFIED  NUMBER(12,0),
    RECORDS_REJECTED  NUMBER(12,0),
    ANOMALIES         NUMBER(8,0),
    MERKLE_ROOT       VARCHAR(64)  NOT NULL,
    REPORT_SHA256     VARCHAR(64)  NOT NULL,
    SIGNER_PUBKEY     VARCHAR(64)  NOT NULL,
    SIGNATURE         VARCHAR(128) NOT NULL,
    REPORT_FILE       VARCHAR(200),
    REPORT            VARIANT
);

CREATE STAGE IF NOT EXISTS ATTESTATION_STAGE
    ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
    COMMENT = 'Exported attestation reports (JSON + Markdown)';

-- ---------------------------------------------------------------------
-- Shipment trust verdict per run: what the business acts on
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_SHIPMENT_TRUST AS
WITH v AS (
    SELECT RUN_ID, SHIPMENT_ID, COUNT(*) AS VERIFIED_READINGS
    FROM VERIFIED_TELEMETRY GROUP BY 1, 2
), r AS (
    SELECT RUN_ID, SHIPMENT_ID, COUNT(*) AS REJECTED_READINGS
    FROM INTEGRITY_REJECTIONS GROUP BY 1, 2
), a AS (
    SELECT RUN_ID, SHIPMENT_ID,
           COUNT(*) AS ANOMALIES,
           LEAST(100, SUM(DECODE(SEVERITY, 'CRITICAL', 60, 'HIGH', 30, 'WARN', 15, 5))) AS RISK_SCORE
    FROM ANOMALY_EVENTS GROUP BY 1, 2
)
SELECT v.RUN_ID,
       v.SHIPMENT_ID,
       s.LOT_ID,
       s.CARRIER,
       s.SHIPPED_KG,
       v.VERIFIED_READINGS,
       COALESCE(r.REJECTED_READINGS, 0) AS REJECTED_READINGS,
       COALESCE(a.ANOMALIES, 0)         AS ANOMALIES,
       COALESCE(a.RISK_SCORE, 0)        AS RISK_SCORE,
       CASE WHEN COALESCE(a.RISK_SCORE, 0) >= 60 THEN 'HOLD'
            WHEN COALESCE(a.RISK_SCORE, 0) >= 25 THEN 'INSPECT'
            ELSE 'RELEASE' END          AS VERDICT
FROM v
LEFT JOIN r ON r.RUN_ID = v.RUN_ID AND r.SHIPMENT_ID = v.SHIPMENT_ID
LEFT JOIN a ON a.RUN_ID = v.RUN_ID AND a.SHIPMENT_ID = v.SHIPMENT_ID
LEFT JOIN BLUEBERRY_CHAIN.RAW.SHIPMENTS s ON s.SHIPMENT_ID = v.SHIPMENT_ID;
