-- =====================================================================
-- BlueberryChain OS - 01 Foundation
-- Database, schemas, warehouses, role, raw tables, audit + policy tables
-- Idempotent: safe to re-run.
-- =====================================================================

USE ROLE ACCOUNTADMIN;

-- ---------------------------------------------------------------------
-- Database + schemas
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS BLUEBERRY_CHAIN
  COMMENT = 'BlueberryChain OS - autonomous chat-driven agriculture supply chain platform';

USE DATABASE BLUEBERRY_CHAIN;

CREATE SCHEMA IF NOT EXISTS RAW      COMMENT = 'Operational source-of-record tables';
CREATE SCHEMA IF NOT EXISTS CURATED  COMMENT = 'Dynamic tables - near real-time derived cold chain state';
CREATE SCHEMA IF NOT EXISTS SEMANTIC COMMENT = 'Governed semantic view - single source of truth for all metrics';
CREATE SCHEMA IF NOT EXISTS TOOLS    COMMENT = 'Stored procedures exposed to Cortex Agents as custom tools';
CREATE SCHEMA IF NOT EXISTS AUDIT    COMMENT = 'Decision log, approval queue, notifications';
CREATE SCHEMA IF NOT EXISTS APP      COMMENT = 'Application support objects';

DROP SCHEMA IF EXISTS PUBLIC;

-- ---------------------------------------------------------------------
-- Warehouses
-- ---------------------------------------------------------------------
CREATE WAREHOUSE IF NOT EXISTS BBC_WH
  WAREHOUSE_SIZE = XSMALL
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'BlueberryChain OS - agents, tools and app queries';

CREATE WAREHOUSE IF NOT EXISTS BBC_DT_WH
  WAREHOUSE_SIZE = XSMALL
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'BlueberryChain OS - dynamic table refreshes';

-- ---------------------------------------------------------------------
-- Role used by agents / app (least privilege, not ACCOUNTADMIN)
-- ---------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS BBC_AGENT_ROLE
  COMMENT = 'Role that Cortex Agents and the chat app run under';

GRANT USAGE ON WAREHOUSE BBC_WH    TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON WAREHOUSE BBC_DT_WH TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON DATABASE BLUEBERRY_CHAIN TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.RAW      TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.CURATED  TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.SEMANTIC TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.TOOLS    TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.AUDIT    TO ROLE BBC_AGENT_ROLE;
GRANT USE AI FUNCTIONS ON ACCOUNT TO ROLE BBC_AGENT_ROLE;
GRANT ROLE BBC_AGENT_ROLE TO ROLE ACCOUNTADMIN;

-- Persona roles used only to prove every persona sees identical metrics
CREATE ROLE IF NOT EXISTS BBC_HARVEST_ROLE   COMMENT = 'Persona: ranch / harvest manager';
CREATE ROLE IF NOT EXISTS BBC_LOGISTICS_ROLE COMMENT = 'Persona: logistics / cold chain';
CREATE ROLE IF NOT EXISTS BBC_QUALITY_ROLE   COMMENT = 'Persona: quality gate';
CREATE ROLE IF NOT EXISTS BBC_FINANCE_ROLE   COMMENT = 'Persona: finance / billing';

-- ---------------------------------------------------------------------
-- RAW: master data
-- ---------------------------------------------------------------------
USE SCHEMA RAW;

CREATE OR REPLACE TABLE RANCHES (
    RANCH_ID         VARCHAR(20)  NOT NULL PRIMARY KEY,
    RANCH_NAME       VARCHAR(100) NOT NULL,
    REGION           VARCHAR(50)  NOT NULL,
    ORGANIC_CERT_ID  VARCHAR(40),
    GROWER_ID        VARCHAR(20)  NOT NULL,
    GROWER_NAME      VARCHAR(100) NOT NULL,
    DISTANCE_TO_DC_KM NUMBER(8,1),
    ACTIVE           BOOLEAN DEFAULT TRUE
) COMMENT = 'Organic blueberry ranches and their growers';

CREATE OR REPLACE TABLE BLOCKS (
    BLOCK_ID    VARCHAR(20)  NOT NULL PRIMARY KEY,
    RANCH_ID    VARCHAR(20)  NOT NULL,
    BLOCK_NAME  VARCHAR(50)  NOT NULL,
    VARIETY     VARCHAR(40)  NOT NULL,
    ACRES       NUMBER(8,2),
    PLANTED_YEAR NUMBER(4,0)
) COMMENT = 'Planting blocks within each ranch';

CREATE OR REPLACE TABLE DC_LOCATIONS (
    DC_CODE     VARCHAR(20)  NOT NULL PRIMARY KEY,
    DC_NAME     VARCHAR(100) NOT NULL,
    REGION      VARCHAR(50),
    ENERGY_COST_PER_KWH NUMBER(8,4) DEFAULT 0.18
) COMMENT = 'Distribution centres receiving blueberry shipments';

-- ---------------------------------------------------------------------
-- RAW: harvest + quality
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE HARVEST_LOTS (
    LOT_ID               VARCHAR(30)  NOT NULL PRIMARY KEY,
    BLOCK_ID             VARCHAR(20)  NOT NULL,
    HARVEST_TS           TIMESTAMP_NTZ NOT NULL,
    VARIETY              VARCHAR(40)  NOT NULL,
    QTY_KG               NUMBER(12,2) NOT NULL,
    INITIAL_BRIX         NUMBER(5,2),
    INITIAL_FIRMNESS_G   NUMBER(6,2),
    SHELF_LIFE_DAYS_BASE NUMBER(4,0)  DEFAULT 14,
    LOT_STATUS           VARCHAR(20)  DEFAULT 'AVAILABLE',
    HOLD_REASON          VARCHAR(500),
    GROWER_PRICE_PER_KG  NUMBER(10,4),
    LAST_UPDATED_TS      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Harvest lots. LOT_STATUS one of AVAILABLE, HOLD, RELEASED, DIVERTED, CONSUMED';

CREATE OR REPLACE TABLE SENSOR_READINGS (
    READING_ID    VARCHAR(40)  NOT NULL PRIMARY KEY,
    LOT_ID        VARCHAR(30)  NOT NULL,
    SENSOR_ID     VARCHAR(30),
    READING_TS    TIMESTAMP_NTZ NOT NULL,
    PULP_TEMP_C   NUMBER(6,2),
    BRIX          NUMBER(5,2),
    FIRMNESS_G    NUMBER(6,2),
    INTERVAL_MIN  NUMBER(5,0) DEFAULT 15
) COMMENT = 'Pulp temperature, Brix and firmness readings per harvest lot';

-- ---------------------------------------------------------------------
-- RAW: logistics
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE SHIPMENTS (
    SHIPMENT_ID         VARCHAR(30)  NOT NULL PRIMARY KEY,
    LOT_ID              VARCHAR(30)  NOT NULL,
    ORIGIN_RANCH_ID     VARCHAR(20)  NOT NULL,
    DC_CODE             VARCHAR(20)  NOT NULL,
    CARRIER             VARCHAR(60),
    REEFER_ID           VARCHAR(30),
    DEPART_TS           TIMESTAMP_NTZ,
    PROMISED_ARRIVAL_TS TIMESTAMP_NTZ,
    ACTUAL_ARRIVAL_TS   TIMESTAMP_NTZ,
    SHIPPED_KG          NUMBER(12,2),
    FREIGHT_COST_USD    NUMBER(12,2),
    STATUS              VARCHAR(20) DEFAULT 'IN_TRANSIT',
    LAST_UPDATED_TS     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Shipments from ranch to DC. STATUS one of IN_TRANSIT, ARRIVED, DIVERTED, CANCELLED';

CREATE OR REPLACE TABLE REEFER_TELEMETRY (
    TELEMETRY_ID   VARCHAR(40)  NOT NULL PRIMARY KEY,
    SHIPMENT_ID    VARCHAR(30)  NOT NULL,
    REEFER_ID      VARCHAR(30),
    READING_TS     TIMESTAMP_NTZ NOT NULL,
    SETPOINT_C     NUMBER(6,2),
    RETURN_AIR_C   NUMBER(6,2),
    SUPPLY_AIR_C   NUMBER(6,2),
    DOOR_OPEN_FLAG BOOLEAN DEFAULT FALSE,
    ENERGY_KWH     NUMBER(10,3)
) COMMENT = 'Reefer unit telemetry per shipment';

-- ---------------------------------------------------------------------
-- RAW: inventory + demand
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE INVENTORY (
    INVENTORY_ID        VARCHAR(40) NOT NULL PRIMARY KEY,
    LOT_ID              VARCHAR(30) NOT NULL,
    DC_CODE             VARCHAR(20) NOT NULL,
    SNAPSHOT_DATE       DATE        NOT NULL,
    ON_HAND_KG          NUMBER(12,2) DEFAULT 0,
    COMMITTED_KG        NUMBER(12,2) DEFAULT 0,
    HOLD_KG             NUMBER(12,2) DEFAULT 0,
    AVG_DAILY_DEMAND_KG NUMBER(12,2) DEFAULT 0,
    LAST_UPDATED_TS     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Daily inventory snapshot per lot and DC. Snapshot fact - must not be summed across dates';

-- ---------------------------------------------------------------------
-- RAW: demand / sales
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE RETAILER_POS (
    PO_ID                 VARCHAR(30) NOT NULL PRIMARY KEY,
    RETAILER_NAME         VARCHAR(100) NOT NULL,
    DC_CODE               VARCHAR(20)  NOT NULL,
    ORDER_TS              TIMESTAMP_NTZ NOT NULL,
    REQUESTED_DELIVERY_TS TIMESTAMP_NTZ,
    STATUS                VARCHAR(20) DEFAULT 'OPEN',
    PROMISE_CONFIDENCE_PCT NUMBER(5,2) DEFAULT 100,
    LAST_UPDATED_TS       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Retailer purchase orders';

CREATE OR REPLACE TABLE PO_LINES (
    PO_LINE_ID          VARCHAR(30) NOT NULL PRIMARY KEY,
    PO_ID               VARCHAR(30) NOT NULL,
    VARIETY             VARCHAR(40),
    ORDERED_KG          NUMBER(12,2) NOT NULL,
    SHIPPED_KG          NUMBER(12,2) DEFAULT 0,
    ACCEPTED_KG         NUMBER(12,2) DEFAULT 0,
    UNIT_PRICE_USD      NUMBER(10,4),
    MIN_SHELF_LIFE_DAYS NUMBER(4,0) DEFAULT 7,
    FILL_STATUS         VARCHAR(20) DEFAULT 'PENDING'
) COMMENT = 'Purchase order lines with retailer shelf-life acceptance threshold';

-- ---------------------------------------------------------------------
-- RAW: finance
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE INVOICES (
    INVOICE_ID           VARCHAR(30) NOT NULL PRIMARY KEY,
    PO_ID                VARCHAR(30),
    SHIPMENT_ID          VARCHAR(30),
    LOT_ID               VARCHAR(30),
    INVOICE_DATE         DATE,
    INVOICED_KG          NUMBER(12,2),
    GROSS_AMOUNT_USD     NUMBER(14,2),
    SHRINK_DEDUCTION_USD NUMBER(14,2) DEFAULT 0,
    NET_AMOUNT_USD       NUMBER(14,2),
    STATUS               VARCHAR(20) DEFAULT 'ISSUED',
    PDF_URL              VARCHAR(500),
    CREATED_TS           TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Customer invoices for delivered shipments';

CREATE OR REPLACE TABLE CREDIT_NOTES (
    CREDIT_NOTE_ID VARCHAR(30) NOT NULL PRIMARY KEY,
    INVOICE_ID     VARCHAR(30),
    PO_ID          VARCHAR(30),
    LOT_ID         VARCHAR(30),
    ISSUE_DATE     DATE,
    AMOUNT_USD     NUMBER(14,2),
    REASON_CODE    VARCHAR(40),
    IS_PROVISIONAL BOOLEAN DEFAULT TRUE,
    STATUS         VARCHAR(20) DEFAULT 'PROVISIONAL',
    PDF_URL        VARCHAR(500),
    CREATED_TS     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Credit notes raised against quality or cold chain failures';

CREATE OR REPLACE TABLE GROWER_SETTLEMENTS (
    SETTLEMENT_ID         VARCHAR(30) NOT NULL PRIMARY KEY,
    LOT_ID                VARCHAR(30) NOT NULL,
    GROWER_ID             VARCHAR(20) NOT NULL,
    SETTLEMENT_DATE       DATE,
    GROSS_KG              NUMBER(12,2),
    ACCEPTED_KG           NUMBER(12,2),
    REJECTED_KG           NUMBER(12,2),
    PRICE_PER_KG          NUMBER(10,4),
    GROSS_AMOUNT_USD      NUMBER(14,2),
    QUALITY_DEDUCTION_USD NUMBER(14,2) DEFAULT 0,
    NET_AMOUNT_USD        NUMBER(14,2),
    STATUS                VARCHAR(20) DEFAULT 'DRAFT',
    CREATED_TS            TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Grower settlements net of quality deductions';

-- Cost components that roll into True Landed Cost
CREATE OR REPLACE TABLE LOT_COST_COMPONENTS (
    COST_ID        VARCHAR(40) NOT NULL PRIMARY KEY,
    LOT_ID         VARCHAR(30) NOT NULL,
    COST_TYPE      VARCHAR(40) NOT NULL,
    AMOUNT_USD     NUMBER(14,2) NOT NULL,
    POSTED_TS      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    SOURCE_TOOL    VARCHAR(60)
) COMMENT = 'Cost ledger per lot. COST_TYPE one of PRODUCT, FREIGHT, ENERGY, SHRINK, CLAIM';

-- ---------------------------------------------------------------------
-- AUDIT
-- ---------------------------------------------------------------------
USE SCHEMA AUDIT;

CREATE OR REPLACE TABLE DECISION_LOG (
    DECISION_ID     VARCHAR(40) NOT NULL PRIMARY KEY,
    THREAD_ID       VARCHAR(80),
    AGENT_NAME      VARCHAR(80),
    TOOL_NAME       VARCHAR(80) NOT NULL,
    ENTITY_TYPE     VARCHAR(40),
    ENTITY_ID       VARCHAR(40),
    ACTION_PAYLOAD  VARIANT,
    METRIC_SNAPSHOT VARIANT,
    AUTONOMY_LEVEL  VARCHAR(30),
    APPROVAL_STATUS VARCHAR(30),
    RESULT_SUMMARY  VARCHAR(2000),
    CREATED_BY      VARCHAR(100) DEFAULT CURRENT_USER(),
    CREATED_AT      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Immutable audit trail. METRIC_SNAPSHOT holds the exact semantic-view metric values read at decision time';

CREATE OR REPLACE TABLE APPROVAL_QUEUE (
    APPROVAL_ID         VARCHAR(40) NOT NULL PRIMARY KEY,
    THREAD_ID           VARCHAR(80),
    AGENT_NAME          VARCHAR(80),
    TOOL_NAME           VARCHAR(80) NOT NULL,
    ACTION_PAYLOAD      VARIANT,
    METRIC_SNAPSHOT     VARIANT,
    ESTIMATED_VALUE_USD NUMBER(14,2),
    STATUS              VARCHAR(20) DEFAULT 'PENDING',
    REQUESTED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    REQUESTED_BY        VARCHAR(100) DEFAULT CURRENT_USER(),
    DECIDED_AT          TIMESTAMP_NTZ,
    DECIDED_BY          VARCHAR(100),
    DECISION_NOTE       VARCHAR(1000)
) COMMENT = 'Human-in-the-loop queue for high-value actions. STATUS one of PENDING, APPROVED, REJECTED, EXECUTED';

CREATE OR REPLACE TABLE NOTIFICATIONS (
    NOTIFICATION_ID     VARCHAR(40) NOT NULL PRIMARY KEY,
    CHANNEL             VARCHAR(30),
    RECIPIENT           VARCHAR(200),
    SUBJECT             VARCHAR(300),
    BODY                VARCHAR(4000),
    RELATED_ENTITY_TYPE VARCHAR(40),
    RELATED_ENTITY_ID   VARCHAR(40),
    SENT_AT             TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Outbound notifications raised by agents';

-- ---------------------------------------------------------------------
-- TOOLS: autonomy policy (table-driven so thresholds change without redeploy)
-- ---------------------------------------------------------------------
USE SCHEMA TOOLS;

CREATE OR REPLACE TABLE AUTONOMY_POLICY (
    TOOL_NAME           VARCHAR(80) NOT NULL PRIMARY KEY,
    AUTONOMY_LEVEL      VARCHAR(30) NOT NULL,
    VALUE_THRESHOLD_USD NUMBER(14,2),
    NOTES               VARCHAR(500)
) COMMENT = 'Per-tool autonomy. FULL_AUTO executes immediately; THRESHOLD executes below VALUE_THRESHOLD_USD then needs approval; APPROVAL_REQUIRED always queues';

INSERT INTO AUTONOMY_POLICY (TOOL_NAME, AUTONOMY_LEVEL, VALUE_THRESHOLD_USD, NOTES) VALUES
  ('HOLD_LOT',                  'FULL_AUTO',         NULL,     'Low risk and reversible - protects product immediately'),
  ('RELEASE_LOT',               'THRESHOLD',         25000,    'Releasing held product above threshold needs a human'),
  ('UPDATE_ATP',                'FULL_AUTO',         NULL,     'Recalculation of availability only'),
  ('SEND_NOTIFICATION',         'FULL_AUTO',         NULL,     'Communication only'),
  ('CALCULATE_TRUE_LANDED_COST','FULL_AUTO',         NULL,     'Posts cost ledger entries only'),
  ('GENERATE_INVOICE',          'FULL_AUTO',         NULL,     'Routine billing against delivered shipments'),
  ('ADJUST_ORDER_PROMISE',      'FULL_AUTO',         NULL,     'Updates fill rate and confidence on an open PO'),
  ('DIVERT_LOT',                'THRESHOLD',         15000,    'Rerouting large consignments needs a human'),
  ('WRITE_CREDIT_NOTE',         'THRESHOLD',         10000,    'Provisional notes auto; final settlement above threshold needs a human'),
  ('CREATE_HARVEST_REQUEST',    'THRESHOLD',         20000,    'Replacement harvest above threshold needs a human'),
  ('CREATE_PO',                 'THRESHOLD',         20000,    'Large replacement POs need a human');

-- ---------------------------------------------------------------------
-- Grants on future + existing objects for the agent role
-- ---------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;

GRANT SELECT ON ALL TABLES IN SCHEMA BLUEBERRY_CHAIN.RAW   TO ROLE BBC_AGENT_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA BLUEBERRY_CHAIN.RAW TO ROLE BBC_AGENT_ROLE;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA BLUEBERRY_CHAIN.RAW TO ROLE BBC_AGENT_ROLE;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA BLUEBERRY_CHAIN.AUDIT TO ROLE BBC_AGENT_ROLE;
GRANT SELECT, INSERT, UPDATE ON FUTURE TABLES IN SCHEMA BLUEBERRY_CHAIN.AUDIT TO ROLE BBC_AGENT_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA BLUEBERRY_CHAIN.TOOLS TO ROLE BBC_AGENT_ROLE;

SELECT 'FOUNDATION COMPLETE' AS STATUS;
