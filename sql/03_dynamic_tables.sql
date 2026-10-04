-- =====================================================================
-- BlueberryChain OS - 03 Dynamic Tables
-- Near-real-time cold chain state.
--
-- DESIGN NOTE: these dynamic tables contain NO non-deterministic
-- functions (no CURRENT_DATE / CURRENT_TIMESTAMP). Non-deterministic
-- expressions force a dynamic table to FULL refresh. All "days
-- remaining / as of now" date arithmetic therefore lives in the
-- semantic view, which is evaluated per query.
--
-- Monotonic aggregates (MIN(firmness), MAX(brix)) are used instead of
-- window functions such as LAST_VALUE so that incremental refresh
-- remains eligible. Firmness only degrades and Brix only rises over a
-- lot's life, so these are equivalent to "latest".
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE SCHEMA CURATED;

-- ---------------------------------------------------------------------
-- 1. Sensor excursions per harvest lot
--    Organic blueberry pulp-temp threshold = 1.8 C
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE DT_SENSOR_EXCURSIONS
  TARGET_LAG = '1 minute'
  WAREHOUSE  = BBC_DT_WH
  REFRESH_MODE = INCREMENTAL
  INITIALIZE = ON_CREATE
  COMMENT = 'Per-lot pulp temperature excursion profile against the 1.8 C organic blueberry threshold'
AS
SELECT
    LOT_ID,
    COUNT(*)                                                    AS READING_COUNT,
    SUM(INTERVAL_MIN)                                           AS TOTAL_MINUTES,
    SUM(CASE WHEN PULP_TEMP_C <= 1.8 THEN INTERVAL_MIN ELSE 0 END) AS COMPLIANT_MINUTES,
    SUM(CASE WHEN PULP_TEMP_C >  1.8 THEN INTERVAL_MIN ELSE 0 END) AS EXCURSION_MINUTES,
    -- Headline figure quoted in conversation, e.g. "3.8 hours above 1.8 C"
    ROUND(SUM(CASE WHEN PULP_TEMP_C > 1.8 THEN INTERVAL_MIN ELSE 0 END) / 60.0, 2)
                                                                AS EXCURSION_HOURS,
    -- Severity: degree-minutes above threshold captures how far, not just how long
    ROUND(SUM(CASE WHEN PULP_TEMP_C > 1.8
                   THEN (PULP_TEMP_C - 1.8) * INTERVAL_MIN ELSE 0 END), 2)
                                                                AS DEGREE_MINUTES_ABOVE,
    ROUND(MAX(PULP_TEMP_C), 2)                                  AS MAX_PULP_TEMP_C,
    ROUND(AVG(PULP_TEMP_C), 2)                                  AS AVG_PULP_TEMP_C,
    ROUND(MAX(BRIX), 2)                                         AS FINAL_BRIX,
    ROUND(MIN(FIRMNESS_G), 2)                                   AS FINAL_FIRMNESS_G,
    MIN(READING_TS)                                             AS FIRST_READING_TS,
    MAX(READING_TS)                                             AS LAST_READING_TS
FROM BLUEBERRY_CHAIN.RAW.SENSOR_READINGS
GROUP BY LOT_ID;

-- ---------------------------------------------------------------------
-- 2. Reefer cold chain performance per shipment
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE DT_SHIPMENT_COLD_CHAIN
  TARGET_LAG = '1 minute'
  WAREHOUSE  = BBC_DT_WH
  REFRESH_MODE = INCREMENTAL
  INITIALIZE = ON_CREATE
  COMMENT = 'Per-shipment reefer compliance, energy draw and modelled cold chain shrink'
AS
SELECT
    t.SHIPMENT_ID,
    MAX(t.REEFER_ID)                                            AS REEFER_ID,
    COUNT(*)                                                    AS TELEMETRY_READINGS,
    SUM(CASE WHEN t.RETURN_AIR_C > 1.8 THEN 1 ELSE 0 END)       AS BREACH_READINGS,
    ROUND(MAX(t.RETURN_AIR_C), 2)                               AS MAX_RETURN_AIR_C,
    ROUND(AVG(t.RETURN_AIR_C), 2)                               AS AVG_RETURN_AIR_C,
    ROUND(AVG(t.SETPOINT_C), 2)                                 AS AVG_SETPOINT_C,
    SUM(CASE WHEN t.DOOR_OPEN_FLAG THEN 1 ELSE 0 END)           AS DOOR_OPEN_EVENTS,
    ROUND(SUM(t.ENERGY_KWH), 3)                                 AS TOTAL_ENERGY_KWH,
    MIN(t.READING_TS)                                           AS FIRST_TELEMETRY_TS,
    MAX(t.READING_TS)                                           AS LAST_TELEMETRY_TS
FROM BLUEBERRY_CHAIN.RAW.REEFER_TELEMETRY t
GROUP BY t.SHIPMENT_ID;

-- ---------------------------------------------------------------------
-- 3. Current harvest lot state: lot + block + ranch + excursion profile
--    This is the grain the Spoilage Risk Score is computed on.
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE DT_HARVEST_LOT_CURRENT
  TARGET_LAG = '1 minute'
  WAREHOUSE  = BBC_DT_WH
  REFRESH_MODE = INCREMENTAL
  INITIALIZE = ON_CREATE
  COMMENT = 'Denormalised current state of every harvest lot with its cold chain and quality profile'
AS
SELECT
    l.LOT_ID,
    l.BLOCK_ID,
    b.RANCH_ID,
    r.RANCH_NAME,
    r.REGION,
    r.GROWER_ID,
    r.GROWER_NAME,
    r.ORGANIC_CERT_ID,
    b.BLOCK_NAME,
    l.VARIETY,
    l.HARVEST_TS,
    l.QTY_KG,
    l.INITIAL_BRIX,
    l.INITIAL_FIRMNESS_G,
    l.SHELF_LIFE_DAYS_BASE,
    l.LOT_STATUS,
    l.HOLD_REASON,
    l.GROWER_PRICE_PER_KG,

    -- Cold chain profile (zero-filled for lots with no telemetry yet)
    COALESCE(e.EXCURSION_HOURS, 0)        AS EXCURSION_HOURS,
    COALESCE(e.EXCURSION_MINUTES, 0)      AS EXCURSION_MINUTES,
    COALESCE(e.COMPLIANT_MINUTES, 0)      AS COMPLIANT_MINUTES,
    COALESCE(e.TOTAL_MINUTES, 0)          AS TOTAL_SENSOR_MINUTES,
    COALESCE(e.DEGREE_MINUTES_ABOVE, 0)   AS DEGREE_MINUTES_ABOVE,
    e.MAX_PULP_TEMP_C,
    e.AVG_PULP_TEMP_C,
    COALESCE(e.FINAL_BRIX, l.INITIAL_BRIX)             AS CURRENT_BRIX,
    COALESCE(e.FINAL_FIRMNESS_G, l.INITIAL_FIRMNESS_G) AS CURRENT_FIRMNESS_G,

    -- Firmness loss as a fraction of the initial reading
    CASE WHEN l.INITIAL_FIRMNESS_G > 0
         THEN ROUND((l.INITIAL_FIRMNESS_G
                     - COALESCE(e.FINAL_FIRMNESS_G, l.INITIAL_FIRMNESS_G))
                    / l.INITIAL_FIRMNESS_G, 4)
         ELSE 0 END                       AS FIRMNESS_LOSS_PCT,

    -- Shelf life actually lost to the cold chain.
    -- Industry rule of thumb: ~0.5 day of shelf life per excursion hour
    -- above threshold, capped so a lot can never go below zero.
    LEAST(COALESCE(e.EXCURSION_HOURS, 0) * 0.5, l.SHELF_LIFE_DAYS_BASE)
                                          AS SHELF_LIFE_DAYS_LOST,
    GREATEST(l.SHELF_LIFE_DAYS_BASE
             - LEAST(COALESCE(e.EXCURSION_HOURS, 0) * 0.5, l.SHELF_LIFE_DAYS_BASE), 0)
                                          AS SHELF_LIFE_DAYS_EFFECTIVE,

    -- Modelled cold chain shrink fraction, driven by excursion severity.
    -- 1.2% baseline handling loss + 0.9% per degree-hour above threshold,
    -- capped at 35%.
    LEAST(0.012 + (COALESCE(e.DEGREE_MINUTES_ABOVE, 0) / 60.0) * 0.009, 0.35)
                                          AS SHRINK_PCT

FROM BLUEBERRY_CHAIN.RAW.HARVEST_LOTS l
JOIN BLUEBERRY_CHAIN.RAW.BLOCKS  b ON b.BLOCK_ID = l.BLOCK_ID
JOIN BLUEBERRY_CHAIN.RAW.RANCHES r ON r.RANCH_ID = b.RANCH_ID
LEFT JOIN DT_SENSOR_EXCURSIONS   e ON e.LOT_ID   = l.LOT_ID;

-- ---------------------------------------------------------------------
-- 4. Shipment delivery + cold chain fact at shipment grain
-- ---------------------------------------------------------------------
CREATE OR REPLACE DYNAMIC TABLE DT_SHIPMENT_DELIVERY
  TARGET_LAG = '1 minute'
  WAREHOUSE  = BBC_DT_WH
  REFRESH_MODE = INCREMENTAL
  INITIALIZE = ON_CREATE
  COMMENT = 'Shipment grain fact: delivery timing, cold chain breach profile and shrink-adjusted delivered quantity'
AS
SELECT
    s.SHIPMENT_ID,
    s.LOT_ID,
    s.ORIGIN_RANCH_ID,
    s.DC_CODE,
    s.CARRIER,
    s.REEFER_ID,
    s.DEPART_TS,
    s.PROMISED_ARRIVAL_TS,
    s.ACTUAL_ARRIVAL_TS,
    s.ACTUAL_ARRIVAL_TS::DATE          AS ARRIVAL_DATE,
    s.SHIPPED_KG,
    s.FREIGHT_COST_USD,
    s.STATUS,

    cc.TELEMETRY_READINGS,
    cc.BREACH_READINGS,
    cc.MAX_RETURN_AIR_C,
    cc.AVG_RETURN_AIR_C,
    cc.DOOR_OPEN_EVENTS,
    cc.TOTAL_ENERGY_KWH,

    -- Delivered on or before the promise
    CASE WHEN s.ACTUAL_ARRIVAL_TS IS NULL THEN NULL
         WHEN s.ACTUAL_ARRIVAL_TS <= s.PROMISED_ARRIVAL_TS THEN 1 ELSE 0 END
                                       AS IS_ON_TIME,

    CASE WHEN s.ACTUAL_ARRIVAL_TS IS NULL THEN NULL
         ELSE ROUND(DATEDIFF('minute', s.PROMISED_ARRIVAL_TS, s.ACTUAL_ARRIVAL_TS) / 60.0, 2)
    END                                AS ARRIVAL_DELAY_HOURS,

    -- Shrink-adjusted quantity actually sellable on arrival
    ROUND(s.SHIPPED_KG * (1 - lc.SHRINK_PCT), 2) AS DELIVERED_SELLABLE_KG,
    ROUND(s.SHIPPED_KG * lc.SHRINK_PCT, 2)       AS SHRINK_KG,
    lc.SHRINK_PCT,
    lc.EXCURSION_HOURS,
    lc.SHELF_LIFE_DAYS_EFFECTIVE,
    lc.VARIETY,
    lc.LOT_STATUS

FROM BLUEBERRY_CHAIN.RAW.SHIPMENTS s
JOIN DT_HARVEST_LOT_CURRENT   lc ON lc.LOT_ID      = s.LOT_ID
LEFT JOIN DT_SHIPMENT_COLD_CHAIN cc ON cc.SHIPMENT_ID = s.SHIPMENT_ID;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
GRANT SELECT ON ALL DYNAMIC TABLES IN SCHEMA BLUEBERRY_CHAIN.CURATED TO ROLE BBC_AGENT_ROLE;
GRANT SELECT ON FUTURE DYNAMIC TABLES IN SCHEMA BLUEBERRY_CHAIN.CURATED TO ROLE BBC_AGENT_ROLE;

-- ---------------------------------------------------------------------
-- Verify refresh mode actually resolved to INCREMENTAL (not just requested)
-- ---------------------------------------------------------------------
SHOW DYNAMIC TABLES IN SCHEMA BLUEBERRY_CHAIN.CURATED;
