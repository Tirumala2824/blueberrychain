-- =============================================================================
-- BlueberryChain OS - WP3: typed operational facts (Dynamic Tables over RAW)
-- Payload contracts: contracts/schemas/raw/payloads/*.json.
-- Master and transactional records keep their latest version per external_id
-- (newest event_ts, then newest received_at); event records keep every event once.
-- Every table carries version_ts / received_at so later stages can explain which
-- version they used. No table reads the current time.
--
-- REFRESH_MODE = AUTO: Snowflake picks INCREMENTAL where the query allows it. CoCo
-- reports the chosen mode (SHOW DYNAMIC TABLES) in the WP3 result log.
-- SHIPMENTS and SHIPMENT_LOTS are pinned INCREMENTAL: they feed the thermal chain in
-- 62_ops_thermal.sql, and AUTO chose FULL for SHIPMENTS ("complex query"), which forced
-- every downstream table to FULL (a FULL DT has no change tracking) and left the detection
-- stream nothing to read.
-- TARGET_LAG = 1 minute: refreshes are skipped when RAW has not changed.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.OPS;

CREATE OR REPLACE DYNAMIC TABLE LOTS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Harvest lots (latest version per lot).'
AS
SELECT
  payload:lot_id::STRING                    AS lot_id,
  payload:product_id::STRING                AS product_id,
  payload:grower_party_id::STRING           AS grower_party_id,
  payload:harvest_site_id::STRING           AS harvest_site_id,
  payload:packhouse_site_id::STRING         AS packhouse_site_id,
  payload:harvest_at::TIMESTAMP_TZ          AS harvest_at,
  payload:packed_at::TIMESTAMP_TZ           AS packed_at,
  payload:kg::NUMBER(14,3)                  AS kg,
  payload:organic::BOOLEAN                  AS organic,
  source_system, event_ts AS version_ts, received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'LOT'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE SHIPMENTS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Shipments: latest plan (TMS SHIPMENT) plus latest status, position and ETA (SHIPMENT_STATUS).'
AS
WITH plan AS (
  SELECT
    payload:shipment_id::STRING            AS shipment_id,
    payload:carrier_party_id::STRING       AS carrier_party_id,
    payload:origin_site_id::STRING         AS origin_site_id,
    payload:destination_site_id::STRING    AS planned_destination_site_id,
    payload:planned_departure_at::TIMESTAMP_TZ AS planned_departure_at,
    payload:planned_arrival_at::TIMESTAMP_TZ   AS planned_arrival_at,
    payload:reefer_device_id::STRING       AS reefer_device_id,
    payload:bol_setpoint_c::NUMBER(5,2)    AS bol_setpoint_c,
    payload:lots                           AS lots,
    payload:status::STRING                 AS planned_status,
    event_ts AS version_ts, received_at
  FROM BBC_OS.RAW.BUSINESS_EVENTS
  WHERE entity_type = 'SHIPMENT'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1
),
status AS (
  SELECT
    payload:shipment_id::STRING            AS shipment_id,
    payload:status::STRING                 AS status,
    payload:at::TIMESTAMP_TZ               AS status_at,
    payload:lat::FLOAT                     AS lat,
    payload:lon::FLOAT                     AS lon,
    payload:next_junction_site_id::STRING  AS next_junction_site_id,
    payload:destination_site_id::STRING    AS destination_site_id,
    payload:eta_at::TIMESTAMP_TZ           AS eta_at
  FROM BBC_OS.RAW.BUSINESS_EVENTS
  WHERE entity_type = 'SHIPMENT_STATUS'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY payload:shipment_id::STRING ORDER BY event_ts DESC, received_at DESC) = 1
)
SELECT
  p.shipment_id, p.carrier_party_id, p.origin_site_id, p.planned_destination_site_id,
  COALESCE(s.destination_site_id, p.planned_destination_site_id) AS destination_site_id,
  p.planned_departure_at, p.planned_arrival_at, p.reefer_device_id, p.bol_setpoint_c, p.lots,
  COALESCE(s.status, p.planned_status) AS status, s.status_at, s.lat, s.lon,
  s.next_junction_site_id, s.eta_at, p.version_ts, p.received_at
FROM plan p
LEFT JOIN status s ON s.shipment_id = p.shipment_id;

CREATE OR REPLACE DYNAMIC TABLE SHIPMENT_LOTS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Which lots ride on which shipment, and how many kg (from the latest shipment plan).'
AS
SELECT s.shipment_id, f.value:lot_id::STRING AS lot_id, f.value:kg::NUMBER(14,3) AS kg
FROM SHIPMENTS s, LATERAL FLATTEN(INPUT => s.lots) f;

CREATE OR REPLACE DYNAMIC TABLE CUSTODY_EVENTS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Handoffs, loads, unloads, arrivals and departures (each event once).'
AS
SELECT
  payload:event_id::STRING        AS event_id,
  payload:event_type::STRING      AS event_type,
  payload:at::TIMESTAMP_TZ        AS at,
  payload:shipment_id::STRING     AS shipment_id,
  payload:lot_id::STRING          AS lot_id,
  payload:from_party_id::STRING   AS from_party_id,
  payload:to_party_id::STRING     AS to_party_id,
  payload:site_id::STRING         AS site_id,
  source_system, received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'CUSTODY_EVENT'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE DEVICE_ASSIGNMENTS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Which device measures which lot (probes) or shipment (reefer units), and when. assigned_to NULL = still assigned.'
AS
SELECT
  external_id                         AS assignment_id,
  payload:device_id::STRING           AS device_id,
  payload:target_type::STRING         AS target_type,
  payload:target_id::STRING           AS target_id,
  payload:role::STRING                AS role,
  payload:assigned_from::TIMESTAMP_TZ AS assigned_from,
  payload:assigned_to::TIMESTAMP_TZ   AS assigned_to,
  event_ts AS version_ts, received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'DEVICE_ASSIGNMENT'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE ORDER_LINES
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Customer sales-order lines (latest version per line).'
AS
SELECT
  payload:order_line_id::STRING                 AS order_line_id,
  payload:sales_order::STRING                   AS sales_order,
  payload:item::STRING                          AS item,
  payload:customer_party_id::STRING             AS customer_party_id,
  payload:product_id::STRING                    AS product_id,
  payload:kg::NUMBER(14,3)                      AS kg,
  payload:price_usd_per_kg::NUMBER(10,4)        AS price_usd_per_kg,
  payload:requested_delivery_at::TIMESTAMP_TZ   AS requested_delivery_at,
  payload:ship_to_site_id::STRING               AS ship_to_site_id,
  payload:status::STRING                        AS status,
  payload:assigned_lot_id::STRING               AS assigned_lot_id,
  payload:last_change_at::TIMESTAMP_TZ          AS last_change_at,
  event_ts AS version_ts, received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'SALES_ORDER_ITEM'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE DELIVERIES
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Outbound deliveries (latest version): which lot fills which order line, and whether goods have issued.'
AS
SELECT
  payload:delivery_id::STRING                   AS delivery_id,
  payload:order_line_id::STRING                 AS order_line_id,
  payload:lot_id::STRING                        AS lot_id,
  payload:shipment_id::STRING                   AS shipment_id,
  payload:kg::NUMBER(14,3)                      AS kg,
  payload:planned_goods_issue_at::TIMESTAMP_TZ  AS planned_goods_issue_at,
  payload:status::STRING                        AS status,
  payload:last_change_at::TIMESTAMP_TZ          AS last_change_at,
  event_ts AS version_ts, received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'DELIVERY'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE INVENTORY_SNAPSHOTS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Stock by site x lot x status at each snapshot. Semi-additive: never sum across snapshot_at.'
AS
SELECT
  payload:site_id::STRING            AS site_id,
  payload:lot_id::STRING             AS lot_id,
  payload:product_id::STRING         AS product_id,
  payload:kg::NUMBER(14,3)           AS kg,
  payload:stock_status::STRING       AS stock_status,
  payload:snapshot_at::TIMESTAMP_TZ  AS snapshot_at,
  received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'STOCK_SNAPSHOT'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE QC_INSPECTIONS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Quality inspections. RECEIPT inspections are the observed outcome of a decision.'
AS
SELECT
  payload:inspection_id::STRING                              AS inspection_id,
  payload:lot_id::STRING                                     AS lot_id,
  payload:site_id::STRING                                    AS site_id,
  payload:inspection_type::STRING                            AS inspection_type,
  payload:inspected_at::TIMESTAMP_TZ                         AS inspected_at,
  payload:pulp_c::NUMBER(5,2)                                AS pulp_c,
  payload:defects_pct::NUMBER(6,3)                           AS defects_pct,
  payload:decay_pct::NUMBER(6,3)                             AS decay_pct,
  payload:remaining_shelf_life_days_observed::NUMBER(6,2)    AS remaining_shelf_life_days_observed,
  payload:accepted::BOOLEAN                                  AS accepted,
  payload:inspector::STRING                                  AS inspector,
  received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'INSPECTION_RESULT'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;

CREATE OR REPLACE DYNAMIC TABLE COUNTERPARTY_RESPONSES
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Carrier and grower replies to claims and deductions. text is untrusted third-party input.'
AS
SELECT
  payload:response_id::STRING               AS response_id,
  payload:claim_ref::STRING                 AS claim_ref,
  payload:counterparty_party_id::STRING     AS counterparty_party_id,
  payload:response_type::STRING             AS response_type,
  payload:amount_usd::NUMBER(14,2)          AS amount_usd,
  payload:defense::STRING                   AS defense,
  payload:text::STRING                      AS text,
  payload:at::TIMESTAMP_TZ                  AS at,
  received_at
FROM BBC_OS.RAW.BUSINESS_EVENTS
WHERE entity_type = 'CLAIM_RESPONSE'
QUALIFY ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY event_ts DESC, received_at DESC) = 1;
