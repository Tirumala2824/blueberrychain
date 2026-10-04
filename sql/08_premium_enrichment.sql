-- =====================================================================
-- BlueberryChain OS - 08 Premium Enrichment
-- 1. Seed a Costco Emerald PO into TRACY-DC so Demo 1's Order Promise
--    step names Costco and shows the exact visual exposure described.
-- 2. Add document payload columns (PDF_B64, DOC_TITLE, DOC_SUMMARY) to
--    INVOICES and CREDIT_NOTES so Finance tools return a real,
--    downloadable artifact instead of only a URL string.
-- Idempotent.
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE WAREHOUSE BBC_WH;
USE SCHEMA RAW;

-- ---------------------------------------------------------------------
-- 1. Costco PO
--    PO-6001 is the Costco Emerald exposure into TRACY-DC. The line the
--    Ranch 14 Block 7 lot was going to fill is left PENDING so the
--    excursion demonstrably affects it.
-- ---------------------------------------------------------------------
INSERT INTO RETAILER_POS (PO_ID, RETAILER_NAME, DC_CODE, ORDER_TS, REQUESTED_DELIVERY_TS, STATUS, PROMISE_CONFIDENCE_PCT)
SELECT 'PO-6001', 'Costco Wholesale', 'TRACY-DC',
       DATEADD('day', -2, CURRENT_DATE())::TIMESTAMP_NTZ,
       DATEADD('hour', 9, DATEADD('day', 2, CURRENT_DATE()))::TIMESTAMP_NTZ,
       'OPEN', 100
WHERE NOT EXISTS (SELECT 1 FROM RETAILER_POS WHERE PO_ID = 'PO-6001');

INSERT INTO PO_LINES (PO_LINE_ID, PO_ID, VARIETY, ORDERED_KG, SHIPPED_KG, ACCEPTED_KG, UNIT_PRICE_USD, MIN_SHELF_LIFE_DAYS, FILL_STATUS)
SELECT 'POL-6001-1', 'PO-6001', 'Emerald', 5600, 0, 0, 11.8000, 9, 'PENDING'
WHERE NOT EXISTS (SELECT 1 FROM PO_LINES WHERE PO_LINE_ID = 'POL-6001-1')
UNION ALL
SELECT 'POL-6001-2', 'PO-6001', 'Duke', 2200, 2200, 2200, 10.6000, 7, 'FILLED'
WHERE NOT EXISTS (SELECT 1 FROM PO_LINES WHERE PO_LINE_ID = 'POL-6001-2');

-- Keep 99_reset_demo.sql in sync: Costco must return to OPEN/PENDING
-- on every reset so the demo is reproducible.

-- ---------------------------------------------------------------------
-- 2. Document payload columns
-- ---------------------------------------------------------------------
ALTER TABLE INVOICES    ADD COLUMN IF NOT EXISTS DOC_TITLE   VARCHAR(300);
ALTER TABLE INVOICES    ADD COLUMN IF NOT EXISTS DOC_SUMMARY VARCHAR(2000);
ALTER TABLE INVOICES    ADD COLUMN IF NOT EXISTS PDF_B64     VARCHAR;
ALTER TABLE CREDIT_NOTES ADD COLUMN IF NOT EXISTS DOC_TITLE   VARCHAR(300);
ALTER TABLE CREDIT_NOTES ADD COLUMN IF NOT EXISTS DOC_SUMMARY VARCHAR(2000);
ALTER TABLE CREDIT_NOTES ADD COLUMN IF NOT EXISTS PDF_B64     VARCHAR;

SELECT 'COSTCO PO' AS CHECK_NAME, p.PO_ID, p.RETAILER_NAME, p.DC_CODE, p.STATUS,
       l.PO_LINE_ID, l.VARIETY, l.ORDERED_KG, l.FILL_STATUS
FROM RETAILER_POS p JOIN PO_LINES l ON l.PO_ID = p.PO_ID
WHERE p.PO_ID = 'PO-6001' ORDER BY l.PO_LINE_ID;

SELECT 'DOC COLUMNS' AS CHECK_NAME, COUNT(*) AS PRESENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'RAW' AND TABLE_NAME IN ('INVOICES','CREDIT_NOTES')
  AND COLUMN_NAME IN ('PDF_B64','DOC_TITLE','DOC_SUMMARY');
