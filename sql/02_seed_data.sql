-- =====================================================================
-- BlueberryChain OS - 02 Seed Data
-- Deterministic, reproducible organic blueberry demo data.
--
-- Pinned demo scenarios:
--   Demo 1: RANCH-14 / Block 7 / Emerald harvested this morning with
--           EXACTLY 3.8 hours above 1.8 C (38 readings x 6 min = 228 min).
--   Demo 2: Several shipments ARRIVED at TRACY-DC yesterday, uninvoiced.
--
-- Telemetry interval is 6 minutes throughout so excursion hours land on
-- exact decimal values (38 * 6 / 60 = 3.8).
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE WAREHOUSE BBC_WH;
USE SCHEMA RAW;

-- ---------------------------------------------------------------------
-- Clear (idempotent re-run)
-- ---------------------------------------------------------------------
TRUNCATE TABLE IF EXISTS LOT_COST_COMPONENTS;
TRUNCATE TABLE IF EXISTS GROWER_SETTLEMENTS;
TRUNCATE TABLE IF EXISTS CREDIT_NOTES;
TRUNCATE TABLE IF EXISTS INVOICES;
TRUNCATE TABLE IF EXISTS PO_LINES;
TRUNCATE TABLE IF EXISTS RETAILER_POS;
TRUNCATE TABLE IF EXISTS INVENTORY;
TRUNCATE TABLE IF EXISTS REEFER_TELEMETRY;
TRUNCATE TABLE IF EXISTS SHIPMENTS;
TRUNCATE TABLE IF EXISTS SENSOR_READINGS;
TRUNCATE TABLE IF EXISTS HARVEST_LOTS;
TRUNCATE TABLE IF EXISTS BLOCKS;
TRUNCATE TABLE IF EXISTS RANCHES;
TRUNCATE TABLE IF EXISTS DC_LOCATIONS;

-- ---------------------------------------------------------------------
-- DCs
-- ---------------------------------------------------------------------
INSERT INTO DC_LOCATIONS (DC_CODE, DC_NAME, REGION, ENERGY_COST_PER_KWH) VALUES
  ('TRACY-DC',    'Tracy Distribution Center',      'Central Valley CA', 0.1850),
  ('SALINAS-DC',  'Salinas Distribution Center',    'Salinas Valley CA', 0.1920),
  ('RENO-DC',     'Reno Distribution Center',       'Northern Nevada',   0.1480),
  ('PHOENIX-DC',  'Phoenix Distribution Center',    'Arizona',           0.1320);

-- ---------------------------------------------------------------------
-- Ranches (16). RANCH-14 is the Demo 1 hero. RANCH-09 is the clean
-- control used for alternative coverage.
-- ---------------------------------------------------------------------
INSERT INTO RANCHES (RANCH_ID, RANCH_NAME, REGION, ORGANIC_CERT_ID, GROWER_ID, GROWER_NAME, DISTANCE_TO_DC_KM, ACTIVE)
SELECT
    'RANCH-' || LPAD(SEQ4() + 1, 2, '0'),
    CASE SEQ4() + 1
      WHEN  9 THEN 'Blue Mesa Ranch 9'
      WHEN 14 THEN 'Emerald Ridge Ranch 14'
      ELSE 'Organic Berry Ranch ' || (SEQ4() + 1)
    END,
    CASE (SEQ4() + 1) % 4
      WHEN 0 THEN 'Central Valley CA'
      WHEN 1 THEN 'Salinas Valley CA'
      WHEN 2 THEN 'San Joaquin CA'
      ELSE 'Monterey County CA'
    END,
    'USDA-ORG-' || LPAD(41000 + (SEQ4() + 1) * 7, 6, '0'),
    'GRW-' || LPAD(((SEQ4() + 1) % 8) + 1, 2, '0'),
    CASE ((SEQ4() + 1) % 8) + 1
      WHEN 1 THEN 'Sierra Organic Growers'
      WHEN 2 THEN 'Pacific Coast Berry Co'
      WHEN 3 THEN 'Harvest Moon Farms'
      WHEN 4 THEN 'Del Rio Organics'
      WHEN 5 THEN 'Golden Valley Berries'
      WHEN 6 THEN 'Cypress Family Farms'
      WHEN 7 THEN 'Valle Verde Organics'
      ELSE 'Still Creek Organics'
    END,
    65 + (ABS(HASH(SEQ4(), 'dist')) % 240),
    TRUE
FROM TABLE(GENERATOR(ROWCOUNT => 16));

-- ---------------------------------------------------------------------
-- Blocks: 4 per ranch. B-<ranch>-<block>. B-14-07 is the hero block.
-- ---------------------------------------------------------------------
INSERT INTO BLOCKS (BLOCK_ID, RANCH_ID, BLOCK_NAME, VARIETY, ACRES, PLANTED_YEAR)
SELECT
    'B-' || SUBSTR(r.RANCH_ID, 7, 2) || '-' || LPAD(b.BN, 2, '0'),
    r.RANCH_ID,
    'Block ' || b.BN,
    CASE
      WHEN r.RANCH_ID = 'RANCH-14' AND b.BN = 7 THEN 'Emerald'
      WHEN r.RANCH_ID = 'RANCH-09' AND b.BN = 7 THEN 'Emerald'
      ELSE CASE ABS(HASH(r.RANCH_ID, b.BN, 'var')) % 4
             WHEN 0 THEN 'Emerald'
             WHEN 1 THEN 'Duke'
             WHEN 2 THEN 'Jewel'
             ELSE 'Star'
           END
    END,
    12.5 + (ABS(HASH(r.RANCH_ID, b.BN, 'ac')) % 220) / 10.0,
    2014 + (ABS(HASH(r.RANCH_ID, b.BN, 'yr')) % 9)
FROM RANCHES r
CROSS JOIN (
    SELECT 5 AS BN UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
) b;

-- ---------------------------------------------------------------------
-- Harvest lots: history (days 1-10 back) + today's explicit lots
-- ---------------------------------------------------------------------

-- Historical lots: ~30% of block/day combinations over the last 10 days
INSERT INTO HARVEST_LOTS (
    LOT_ID, BLOCK_ID, HARVEST_TS, VARIETY, QTY_KG,
    INITIAL_BRIX, INITIAL_FIRMNESS_G, SHELF_LIFE_DAYS_BASE,
    LOT_STATUS, HOLD_REASON, GROWER_PRICE_PER_KG
)
SELECT
    'LOT-' || TO_CHAR(DATEADD('day', -d.DN, CURRENT_DATE()), 'YYYYMMDD')
          || '-' || SUBSTR(bl.BLOCK_ID, 3),
    bl.BLOCK_ID,
    DATEADD('hour', 6, DATEADD('day', -d.DN, CURRENT_DATE()))::TIMESTAMP_NTZ,
    bl.VARIETY,
    1800 + (ABS(HASH(bl.BLOCK_ID, d.DN, 'qty')) % 3600),
    11.0 + (ABS(HASH(bl.BLOCK_ID, d.DN, 'brix')) % 32) / 10.0,
    160 + (ABS(HASH(bl.BLOCK_ID, d.DN, 'firm')) % 60),
    14,
    CASE
      -- two pre-existing quality holds for realism
      WHEN bl.BLOCK_ID = 'B-03-06' AND d.DN = 4 THEN 'HOLD'
      WHEN bl.BLOCK_ID = 'B-11-08' AND d.DN = 6 THEN 'HOLD'
      WHEN d.DN >= 7 THEN 'CONSUMED'
      ELSE 'AVAILABLE'
    END,
    CASE
      WHEN bl.BLOCK_ID = 'B-03-06' AND d.DN = 4 THEN 'Firmness below organic grade spec at intake'
      WHEN bl.BLOCK_ID = 'B-11-08' AND d.DN = 6 THEN 'Open quality investigation - suspected pulp temp breach'
      ELSE NULL
    END,
    5.40 + (ABS(HASH(bl.BLOCK_ID, 'price')) % 220) / 100.0
FROM BLOCKS bl
CROSS JOIN (
    SELECT SEQ4() + 1 AS DN FROM TABLE(GENERATOR(ROWCOUNT => 10))
) d
WHERE ABS(HASH(bl.BLOCK_ID, d.DN, 'pick')) % 10 < 3;

-- Today's lots, explicit. The hero lot is first.
INSERT INTO HARVEST_LOTS (
    LOT_ID, BLOCK_ID, HARVEST_TS, VARIETY, QTY_KG,
    INITIAL_BRIX, INITIAL_FIRMNESS_G, SHELF_LIFE_DAYS_BASE,
    LOT_STATUS, HOLD_REASON, GROWER_PRICE_PER_KG
)
SELECT 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-14-07',
       'B-14-07',
       DATEADD('hour', 6, CURRENT_DATE())::TIMESTAMP_NTZ,
       'Emerald', 4200, 12.40, 185, 14, 'AVAILABLE', NULL, 6.8000
UNION ALL
SELECT 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-14-05',
       'B-14-05',
       DATEADD('hour', 6, CURRENT_DATE())::TIMESTAMP_NTZ,
       (SELECT VARIETY FROM BLOCKS WHERE BLOCK_ID = 'B-14-05'),
       2650, 11.80, 178, 14, 'AVAILABLE', NULL, 6.2000
UNION ALL
-- Clean control lot on RANCH-09: the alternative coverage source
SELECT 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-09-07',
       'B-09-07',
       DATEADD('hour', 6, CURRENT_DATE())::TIMESTAMP_NTZ,
       'Emerald', 5100, 12.90, 192, 14, 'AVAILABLE', NULL, 7.1000
UNION ALL
SELECT 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-06-06',
       'B-06-06',
       DATEADD('hour', 6, CURRENT_DATE())::TIMESTAMP_NTZ,
       (SELECT VARIETY FROM BLOCKS WHERE BLOCK_ID = 'B-06-06'),
       3300, 12.10, 181, 14, 'AVAILABLE', NULL, 6.0500;

-- ---------------------------------------------------------------------
-- Sensor readings: 120 readings per lot at 6-minute intervals.
--
-- Excursion window starts at reading index 10. Number of readings above
-- the 1.8 C organic blueberry threshold:
--   hero lot          -> exactly 38  (38 * 6 / 60 = 3.8 hours)
--   RANCH-09 control  -> 0           (clean cold chain)
--   all other lots    -> deterministic 0..33
-- ---------------------------------------------------------------------
INSERT INTO SENSOR_READINGS (READING_ID, LOT_ID, SENSOR_ID, READING_TS, PULP_TEMP_C, BRIX, FIRMNESS_G, INTERVAL_MIN)
WITH idx AS (
    SELECT SEQ4() AS I FROM TABLE(GENERATOR(ROWCOUNT => 120))
),
lot_exc AS (
    SELECT
        l.LOT_ID, l.HARVEST_TS, l.INITIAL_BRIX, l.INITIAL_FIRMNESS_G, l.BLOCK_ID,
        CASE
          WHEN l.LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-14-07' THEN 38
          WHEN l.LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-09-07' THEN 0
          ELSE ABS(HASH(l.LOT_ID, 'excursion')) % 34
        END AS EXC_N
    FROM HARVEST_LOTS l
)
SELECT
    'RD-' || le.LOT_ID || '-' || LPAD(idx.I, 3, '0'),
    le.LOT_ID,
    'SNS-' || SUBSTR(le.BLOCK_ID, 3) || '-A',
    DATEADD('minute', idx.I * 6, le.HARVEST_TS),
    -- Pulp temperature: warm inside the excursion window, compliant outside
    CASE
      WHEN le.EXC_N > 0 AND idx.I >= 10 AND idx.I < 10 + le.EXC_N
        THEN ROUND(2.10 + ((idx.I - 10) * 0.065)
                   + (ABS(HASH(le.LOT_ID, idx.I, 't')) % 25) / 100.0, 2)
      ELSE ROUND(0.40 + (ABS(HASH(le.LOT_ID, idx.I, 'c')) % 120) / 100.0, 2)
    END,
    -- Brix drifts up slightly with time and heat
    ROUND(le.INITIAL_BRIX
          + (idx.I * 0.004)
          + CASE WHEN le.EXC_N > 0 AND idx.I >= 10 + le.EXC_N THEN 0.18 ELSE 0 END, 2),
    -- Firmness degrades, faster after an excursion
    ROUND(le.INITIAL_FIRMNESS_G
          - (idx.I * 0.085)
          - CASE WHEN le.EXC_N > 0 AND idx.I >= 10 THEN le.EXC_N * 0.42 ELSE 0 END, 2),
    6
FROM lot_exc le
CROSS JOIN idx;

-- ---------------------------------------------------------------------
-- Shipments. Lots harvested 1+ days ago ship; a cohort arrives at
-- TRACY-DC yesterday for Demo 2.
-- ---------------------------------------------------------------------
INSERT INTO SHIPMENTS (
    SHIPMENT_ID, LOT_ID, ORIGIN_RANCH_ID, DC_CODE, CARRIER, REEFER_ID,
    DEPART_TS, PROMISED_ARRIVAL_TS, ACTUAL_ARRIVAL_TS, SHIPPED_KG,
    FREIGHT_COST_USD, STATUS
)
SELECT
    'SHP-' || SUBSTR(l.LOT_ID, 5),
    l.LOT_ID,
    bl.RANCH_ID,
    CASE ABS(HASH(l.LOT_ID, 'dc')) % 10
      WHEN 0 THEN 'SALINAS-DC'
      WHEN 1 THEN 'RENO-DC'
      WHEN 2 THEN 'PHOENIX-DC'
      ELSE 'TRACY-DC'          -- majority to Tracy so Demo 2 has volume
    END,
    CASE ABS(HASH(l.LOT_ID, 'car')) % 4
      WHEN 0 THEN 'ColdLine Freight'
      WHEN 1 THEN 'ValleyReefer Logistics'
      WHEN 2 THEN 'Sierra Cold Transport'
      ELSE 'PacWest Refrigerated'
    END,
    'RFR-' || LPAD(ABS(HASH(l.LOT_ID, 'rfr')) % 40 + 1, 3, '0'),
    DATEADD('hour', 14, l.HARVEST_TS),
    DATEADD('hour', 26, l.HARVEST_TS),
    -- lots harvested 2+ days back have arrived; day-1 lots arrived yesterday
    CASE WHEN l.HARVEST_TS < DATEADD('day', -1, CURRENT_DATE())
         THEN DATEADD('hour', 25 + (ABS(HASH(l.LOT_ID, 'arr')) % 6), l.HARVEST_TS)
    END,
    ROUND(l.QTY_KG * 0.985, 2),
    ROUND(380 + (r.DISTANCE_TO_DC_KM * 1.85), 2),
    CASE WHEN l.HARVEST_TS < DATEADD('day', -1, CURRENT_DATE())
         THEN 'ARRIVED' ELSE 'IN_TRANSIT' END
FROM HARVEST_LOTS l
JOIN BLOCKS bl ON bl.BLOCK_ID = l.BLOCK_ID
JOIN RANCHES r ON r.RANCH_ID = bl.RANCH_ID
WHERE l.HARVEST_TS < DATEADD('hour', 6, CURRENT_DATE());

-- Force a clean cohort of TRACY-DC arrivals dated yesterday for Demo 2
UPDATE SHIPMENTS s
SET ACTUAL_ARRIVAL_TS = DATEADD('hour', 9 + (ABS(HASH(s.SHIPMENT_ID, 'y')) % 8),
                                DATEADD('day', -1, CURRENT_DATE()))::TIMESTAMP_NTZ,
    STATUS = 'ARRIVED',
    DC_CODE = 'TRACY-DC'
WHERE s.LOT_ID IN (
    SELECT LOT_ID FROM HARVEST_LOTS
    WHERE HARVEST_TS >= DATEADD('day', -3, CURRENT_DATE())
      AND HARVEST_TS <  DATEADD('day', -1, CURRENT_DATE())
);

-- ---------------------------------------------------------------------
-- Reefer telemetry: 60 readings per shipment at 12-minute intervals.
-- One reefer (RFR-013) runs a failing setpoint.
-- ---------------------------------------------------------------------
INSERT INTO REEFER_TELEMETRY (
    TELEMETRY_ID, SHIPMENT_ID, REEFER_ID, READING_TS,
    SETPOINT_C, RETURN_AIR_C, SUPPLY_AIR_C, DOOR_OPEN_FLAG, ENERGY_KWH
)
WITH idx AS (SELECT SEQ4() AS I FROM TABLE(GENERATOR(ROWCOUNT => 60)))
SELECT
    'TLM-' || SUBSTR(s.SHIPMENT_ID, 5) || '-' || LPAD(idx.I, 3, '0'),
    s.SHIPMENT_ID,
    s.REEFER_ID,
    DATEADD('minute', idx.I * 12, s.DEPART_TS),
    0.50,
    CASE WHEN s.REEFER_ID = 'RFR-013'
         THEN ROUND(2.60 + (ABS(HASH(s.SHIPMENT_ID, idx.I, 'r')) % 90) / 100.0, 2)
         ELSE ROUND(0.45 + (ABS(HASH(s.SHIPMENT_ID, idx.I, 'r')) % 70) / 100.0, 2)
    END,
    CASE WHEN s.REEFER_ID = 'RFR-013'
         THEN ROUND(1.90 + (ABS(HASH(s.SHIPMENT_ID, idx.I, 's')) % 60) / 100.0, 2)
         ELSE ROUND(0.10 + (ABS(HASH(s.SHIPMENT_ID, idx.I, 's')) % 45) / 100.0, 2)
    END,
    (ABS(HASH(s.SHIPMENT_ID, idx.I, 'd')) % 50 = 0),
    ROUND(1.30 + (ABS(HASH(s.SHIPMENT_ID, idx.I, 'e')) % 90) / 100.0, 3)
FROM SHIPMENTS s
CROSS JOIN idx
WHERE s.DEPART_TS IS NOT NULL;

-- ---------------------------------------------------------------------
-- Inventory: daily snapshot per arrived lot at its DC, last 5 days.
-- Snapshot fact - must never be summed across SNAPSHOT_DATE.
-- ---------------------------------------------------------------------
INSERT INTO INVENTORY (
    INVENTORY_ID, LOT_ID, DC_CODE, SNAPSHOT_DATE,
    ON_HAND_KG, COMMITTED_KG, HOLD_KG, AVG_DAILY_DEMAND_KG
)
WITH days AS (SELECT SEQ4() AS DN FROM TABLE(GENERATOR(ROWCOUNT => 5)))
SELECT
    'INV-' || SUBSTR(s.LOT_ID, 5) || '-' || TO_CHAR(DATEADD('day', -d.DN, CURRENT_DATE()), 'YYYYMMDD'),
    s.LOT_ID,
    s.DC_CODE,
    DATEADD('day', -d.DN, CURRENT_DATE()),
    GREATEST(ROUND(s.SHIPPED_KG * (1 - (d.DN * 0.06))
             - (ABS(HASH(s.LOT_ID, d.DN, 'dep')) % 240), 2), 0),
    ROUND(s.SHIPPED_KG * (0.18 + (ABS(HASH(s.LOT_ID, d.DN, 'cm')) % 22) / 100.0), 2),
    CASE WHEN l.LOT_STATUS = 'HOLD' THEN ROUND(s.SHIPPED_KG, 2) ELSE 0 END,
    ROUND(260 + (ABS(HASH(s.LOT_ID, 'dmd')) % 520), 2)
FROM SHIPMENTS s
JOIN HARVEST_LOTS l ON l.LOT_ID = s.LOT_ID
CROSS JOIN days d
WHERE s.ACTUAL_ARRIVAL_TS IS NOT NULL
  AND DATEADD('day', -d.DN, CURRENT_DATE()) >= s.ACTUAL_ARRIVAL_TS::DATE;

-- ---------------------------------------------------------------------
-- Retailer POs + lines. PO-5001 is the Demo 1 exposure: Emerald into
-- TRACY-DC that the hero lot was going to fill.
-- ---------------------------------------------------------------------
INSERT INTO RETAILER_POS (PO_ID, RETAILER_NAME, DC_CODE, ORDER_TS, REQUESTED_DELIVERY_TS, STATUS, PROMISE_CONFIDENCE_PCT)
SELECT 'PO-5001', 'FreshMart West', 'TRACY-DC',
       DATEADD('day', -2, CURRENT_DATE())::TIMESTAMP_NTZ,
       DATEADD('hour', 10, DATEADD('day', 2, CURRENT_DATE()))::TIMESTAMP_NTZ,
       'OPEN', 100
UNION ALL
SELECT 'PO-5002', 'GreenLeaf Markets', 'TRACY-DC',
       DATEADD('day', -3, CURRENT_DATE())::TIMESTAMP_NTZ,
       DATEADD('hour', 10, DATEADD('day', 1, CURRENT_DATE()))::TIMESTAMP_NTZ,
       'OPEN', 100
UNION ALL
SELECT 'PO-5003', 'Harvest Table Co-op', 'SALINAS-DC',
       DATEADD('day', -4, CURRENT_DATE())::TIMESTAMP_NTZ,
       DATEADD('hour', 10, DATEADD('day', 1, CURRENT_DATE()))::TIMESTAMP_NTZ,
       'OPEN', 95
UNION ALL
SELECT 'PO-' || (5003 + SEQ4() + 1),
       CASE (SEQ4() + 1) % 4
         WHEN 0 THEN 'FreshMart West'
         WHEN 1 THEN 'GreenLeaf Markets'
         WHEN 2 THEN 'Harvest Table Co-op'
         ELSE 'Westside Grocers'
       END,
       CASE (SEQ4() + 1) % 3 WHEN 0 THEN 'TRACY-DC' WHEN 1 THEN 'RENO-DC' ELSE 'PHOENIX-DC' END,
       DATEADD('day', -((SEQ4() + 1) % 7) - 1, CURRENT_DATE())::TIMESTAMP_NTZ,
       DATEADD('day', ((SEQ4() + 1) % 4), CURRENT_DATE())::TIMESTAMP_NTZ,
       CASE WHEN (SEQ4() + 1) % 5 = 0 THEN 'CLOSED' ELSE 'OPEN' END,
       100
FROM TABLE(GENERATOR(ROWCOUNT => 24));

INSERT INTO PO_LINES (PO_LINE_ID, PO_ID, VARIETY, ORDERED_KG, SHIPPED_KG, ACCEPTED_KG, UNIT_PRICE_USD, MIN_SHELF_LIFE_DAYS, FILL_STATUS)
SELECT 'POL-5001-1', 'PO-5001', 'Emerald', 4000, 0, 0, 11.5000, 9, 'PENDING'
UNION ALL
SELECT 'POL-5001-2', 'PO-5001', 'Duke',    1500, 1500, 1500, 10.2000, 7, 'FILLED'
UNION ALL
-- deliberate shortfall for realism
SELECT 'POL-5002-1', 'PO-5002', 'Jewel',   3200, 2450, 2450, 10.8000, 7, 'SHORT'
UNION ALL
SELECT 'POL-5003-1', 'PO-5003', 'Star',    2800, 2800, 2800, 9.9000, 7, 'FILLED'
UNION ALL
SELECT 'POL-' || SUBSTR(p.PO_ID, 4) || '-1',
       p.PO_ID,
       CASE ABS(HASH(p.PO_ID, 'v')) % 4
         WHEN 0 THEN 'Emerald' WHEN 1 THEN 'Duke' WHEN 2 THEN 'Jewel' ELSE 'Star' END,
       1200 + (ABS(HASH(p.PO_ID, 'ord')) % 3400),
       ROUND((1200 + (ABS(HASH(p.PO_ID, 'ord')) % 3400))
             * (0.86 + (ABS(HASH(p.PO_ID, 'sh')) % 14) / 100.0), 2),
       ROUND((1200 + (ABS(HASH(p.PO_ID, 'ord')) % 3400))
             * (0.84 + (ABS(HASH(p.PO_ID, 'sh')) % 14) / 100.0), 2),
       9.50 + (ABS(HASH(p.PO_ID, 'pr')) % 280) / 100.0,
       7,
       'FILLED'
FROM RETAILER_POS p
WHERE p.PO_ID NOT IN ('PO-5001', 'PO-5002', 'PO-5003');

-- ---------------------------------------------------------------------
-- Cost ledger: PRODUCT, FREIGHT and ENERGY for every shipment.
-- SHRINK and CLAIM are posted later by the agent tools.
-- ---------------------------------------------------------------------
INSERT INTO LOT_COST_COMPONENTS (COST_ID, LOT_ID, COST_TYPE, AMOUNT_USD, SOURCE_TOOL)
SELECT 'CST-' || SUBSTR(l.LOT_ID, 5) || '-PRD', l.LOT_ID, 'PRODUCT',
       ROUND(l.QTY_KG * l.GROWER_PRICE_PER_KG, 2), 'SEED'
FROM HARVEST_LOTS l
UNION ALL
SELECT 'CST-' || SUBSTR(s.LOT_ID, 5) || '-FRT', s.LOT_ID, 'FREIGHT',
       s.FREIGHT_COST_USD, 'SEED'
FROM SHIPMENTS s
UNION ALL
SELECT 'CST-' || SUBSTR(t.SHIPMENT_ID, 5) || '-ENG', s.LOT_ID, 'ENERGY',
       ROUND(SUM(t.ENERGY_KWH) * dc.ENERGY_COST_PER_KWH, 2), 'SEED'
FROM REEFER_TELEMETRY t
JOIN SHIPMENTS s ON s.SHIPMENT_ID = t.SHIPMENT_ID
JOIN DC_LOCATIONS dc ON dc.DC_CODE = s.DC_CODE
GROUP BY t.SHIPMENT_ID, s.LOT_ID, dc.ENERGY_COST_PER_KWH;

-- ---------------------------------------------------------------------
-- Historical invoices + settlements for lots older than 3 days, so the
-- Demo 2 cohort (yesterday's Tracy arrivals) is genuinely uninvoiced.
-- ---------------------------------------------------------------------
INSERT INTO INVOICES (INVOICE_ID, PO_ID, SHIPMENT_ID, LOT_ID, INVOICE_DATE, INVOICED_KG,
                      GROSS_AMOUNT_USD, SHRINK_DEDUCTION_USD, NET_AMOUNT_USD, STATUS, PDF_URL)
SELECT
    'INV-' || SUBSTR(s.LOT_ID, 5),
    NULL, s.SHIPMENT_ID, s.LOT_ID,
    s.ACTUAL_ARRIVAL_TS::DATE,
    ROUND(s.SHIPPED_KG, 2),
    ROUND(s.SHIPPED_KG * 11.20, 2),
    0,
    ROUND(s.SHIPPED_KG * 11.20, 2),
    'PAID',
    'https://bbc-docs.internal/invoices/INV-' || SUBSTR(s.LOT_ID, 5) || '.pdf'
FROM SHIPMENTS s
WHERE s.ACTUAL_ARRIVAL_TS IS NOT NULL
  AND s.ACTUAL_ARRIVAL_TS < DATEADD('day', -3, CURRENT_DATE());

INSERT INTO GROWER_SETTLEMENTS (SETTLEMENT_ID, LOT_ID, GROWER_ID, SETTLEMENT_DATE, GROSS_KG,
                                ACCEPTED_KG, REJECTED_KG, PRICE_PER_KG, GROSS_AMOUNT_USD,
                                QUALITY_DEDUCTION_USD, NET_AMOUNT_USD, STATUS)
SELECT
    'STL-' || SUBSTR(l.LOT_ID, 5),
    l.LOT_ID, r.GROWER_ID,
    s.ACTUAL_ARRIVAL_TS::DATE,
    l.QTY_KG,
    ROUND(l.QTY_KG * 0.97, 2),
    ROUND(l.QTY_KG * 0.03, 2),
    l.GROWER_PRICE_PER_KG,
    ROUND(l.QTY_KG * l.GROWER_PRICE_PER_KG, 2),
    ROUND(l.QTY_KG * 0.03 * l.GROWER_PRICE_PER_KG, 2),
    ROUND(l.QTY_KG * 0.97 * l.GROWER_PRICE_PER_KG, 2),
    'SETTLED'
FROM HARVEST_LOTS l
JOIN BLOCKS bl ON bl.BLOCK_ID = l.BLOCK_ID
JOIN RANCHES r ON r.RANCH_ID = bl.RANCH_ID
JOIN SHIPMENTS s ON s.LOT_ID = l.LOT_ID
WHERE s.ACTUAL_ARRIVAL_TS IS NOT NULL
  AND s.ACTUAL_ARRIVAL_TS < DATEADD('day', -3, CURRENT_DATE());

-- ---------------------------------------------------------------------
-- Verification of the two pinned demo scenarios
-- ---------------------------------------------------------------------
SELECT 'HERO LOT EXCURSION CHECK' AS CHECK_NAME,
       LOT_ID,
       COUNT(*) AS READINGS_ABOVE_THRESHOLD,
       ROUND(COUNT(*) * 6 / 60.0, 2) AS HOURS_ABOVE_1_8C
FROM SENSOR_READINGS
WHERE LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(), 'YYYYMMDD') || '-14-07'
  AND PULP_TEMP_C > 1.8
GROUP BY LOT_ID;

SELECT 'TRACY YESTERDAY ARRIVALS' AS CHECK_NAME,
       COUNT(*) AS SHIPMENTS,
       ROUND(SUM(SHIPPED_KG), 2) AS TOTAL_KG
FROM SHIPMENTS
WHERE DC_CODE = 'TRACY-DC'
  AND ACTUAL_ARRIVAL_TS::DATE = DATEADD('day', -1, CURRENT_DATE());

SELECT 'ROW COUNTS' AS CHECK_NAME, 'HARVEST_LOTS' AS TBL, COUNT(*) AS N FROM HARVEST_LOTS
UNION ALL SELECT 'ROW COUNTS', 'SENSOR_READINGS',  COUNT(*) FROM SENSOR_READINGS
UNION ALL SELECT 'ROW COUNTS', 'SHIPMENTS',        COUNT(*) FROM SHIPMENTS
UNION ALL SELECT 'ROW COUNTS', 'REEFER_TELEMETRY', COUNT(*) FROM REEFER_TELEMETRY
UNION ALL SELECT 'ROW COUNTS', 'INVENTORY',        COUNT(*) FROM INVENTORY
UNION ALL SELECT 'ROW COUNTS', 'PO_LINES',         COUNT(*) FROM PO_LINES
UNION ALL SELECT 'ROW COUNTS', 'INVOICES',         COUNT(*) FROM INVOICES
ORDER BY TBL;
