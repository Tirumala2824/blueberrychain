-- =====================================================================
-- BlueberryChain OS - 04 Semantic View
-- SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
--
-- THE SINGLE SOURCE OF TRUTH.
--
-- Every canonical metric is defined exactly once, here. No agent, tool
-- or application is permitted to recompute any of these numbers in its
-- own SQL. The stored-procedure tools in BLUEBERRY_CHAIN.TOOLS read
-- their metric values from this view before acting, and record those
-- exact values in AUDIT.DECISION_LOG.
--
-- The 7 canonical metrics:
--   1. SPOILAGE_RISK_SCORE        (lots)
--   2. TEMPERATURE_COMPLIANCE_PCT (lots)
--   3. SHELF_LIFE_ADJUSTED_OTD    (shipments)
--   4. QUALITY_ADJUSTED_FILL_RATE (po_lines)
--   5. TRUE_LANDED_COST           (cost_ledger)
--   6. LIVE_DOI                   (derived, semi-additive)
--   7. ATP_QUALITY_ADJUSTED       (inventory, semi-additive)
--
-- SEMI-ADDITIVE WARNING: INVENTORY is a daily snapshot fact. Summing
-- ON_HAND_KG across SNAPSHOT_DATE silently inflates every availability
-- number. LIVE_DOI and ATP_QUALITY_ADJUSTED therefore declare
-- NON ADDITIVE BY (d_snapshot_date) so the engine takes the latest
-- snapshot instead of a sum across time.
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE SCHEMA SEMANTIC;

CREATE OR REPLACE SEMANTIC VIEW SEMANTIC.ORGANIC_BLUEBERRY_CHAIN

  TABLES (
    lots AS BLUEBERRY_CHAIN.CURATED.DT_HARVEST_LOT_CURRENT
      PRIMARY KEY (LOT_ID)
      WITH SYNONYMS = ('harvest lots', 'berry lots', 'blueberry lots', 'picked lots')
      COMMENT = 'Current state of every organic blueberry harvest lot, including its cold chain excursion profile, quality readings and effective shelf life',

    shipments AS BLUEBERRY_CHAIN.CURATED.DT_SHIPMENT_DELIVERY
      PRIMARY KEY (SHIPMENT_ID)
      WITH SYNONYMS = ('deliveries', 'loads', 'truckloads', 'reefer shipments')
      COMMENT = 'Shipments from ranch to distribution centre with delivery timing, reefer breach profile and shrink-adjusted delivered quantity',

    inventory AS BLUEBERRY_CHAIN.RAW.INVENTORY
      PRIMARY KEY (INVENTORY_ID)
      WITH SYNONYMS = ('stock', 'on hand', 'warehouse stock')
      COMMENT = 'Daily inventory snapshot per lot and DC. SNAPSHOT FACT - never sum across snapshot date',

    po_lines AS BLUEBERRY_CHAIN.RAW.PO_LINES
      PRIMARY KEY (PO_LINE_ID)
      WITH SYNONYMS = ('order lines', 'purchase order lines', 'retailer order lines')
      COMMENT = 'Retailer purchase order lines with ordered, shipped and accepted quantities and the retailer minimum shelf-life threshold',

    retailer_pos AS BLUEBERRY_CHAIN.RAW.RETAILER_POS
      PRIMARY KEY (PO_ID)
      WITH SYNONYMS = ('purchase orders', 'customer orders', 'retailer POs')
      COMMENT = 'Retailer purchase order headers with requested delivery date and current promise confidence',

    ranches AS BLUEBERRY_CHAIN.RAW.RANCHES
      PRIMARY KEY (RANCH_ID)
      WITH SYNONYMS = ('farms', 'growers sites', 'ranch')
      COMMENT = 'Organic blueberry ranches, their region, organic certification and grower',

    blocks AS BLUEBERRY_CHAIN.RAW.BLOCKS
      PRIMARY KEY (BLOCK_ID)
      WITH SYNONYMS = ('planting blocks', 'fields', 'block')
      COMMENT = 'Planting blocks within a ranch, each with a single blueberry variety',

    dcs AS BLUEBERRY_CHAIN.RAW.DC_LOCATIONS
      PRIMARY KEY (DC_CODE)
      WITH SYNONYMS = ('distribution centres', 'distribution centers', 'DCs', 'warehouses')
      COMMENT = 'Distribution centres that receive blueberry shipments',

    cost_ledger AS BLUEBERRY_CHAIN.RAW.LOT_COST_COMPONENTS
      PRIMARY KEY (COST_ID)
      WITH SYNONYMS = ('costs', 'landed cost ledger', 'cost components')
      COMMENT = 'Cost ledger per lot. COST_TYPE is one of PRODUCT, FREIGHT, ENERGY, SHRINK or CLAIM. Sums to True Landed Cost',

    invoices AS BLUEBERRY_CHAIN.RAW.INVOICES
      PRIMARY KEY (INVOICE_ID)
      WITH SYNONYMS = ('customer invoices', 'billing')
      COMMENT = 'Customer invoices raised against delivered shipments',

    credit_notes AS BLUEBERRY_CHAIN.RAW.CREDIT_NOTES
      PRIMARY KEY (CREDIT_NOTE_ID)
      WITH SYNONYMS = ('credits', 'claims', 'credit memos')
      COMMENT = 'Credit notes raised against quality or cold chain failures. Provisional until the claim is settled',

    settlements AS BLUEBERRY_CHAIN.RAW.GROWER_SETTLEMENTS
      PRIMARY KEY (SETTLEMENT_ID)
      WITH SYNONYMS = ('grower settlements', 'grower payments', 'grower bills')
      COMMENT = 'Grower settlements net of quality deductions'
  )

  RELATIONSHIPS (
    lots_to_blocks          AS lots(BLOCK_ID)            REFERENCES blocks(BLOCK_ID),
    blocks_to_ranches       AS blocks(RANCH_ID)          REFERENCES ranches(RANCH_ID),
    shipments_to_lots       AS shipments(LOT_ID)         REFERENCES lots(LOT_ID),
    shipments_to_dcs        AS shipments(DC_CODE)        REFERENCES dcs(DC_CODE),
    inventory_to_lots       AS inventory(LOT_ID)         REFERENCES lots(LOT_ID),
    inventory_to_dcs        AS inventory(DC_CODE)        REFERENCES dcs(DC_CODE),
    po_lines_to_pos         AS po_lines(PO_ID)           REFERENCES retailer_pos(PO_ID),
    pos_to_dcs              AS retailer_pos(DC_CODE)     REFERENCES dcs(DC_CODE),
    cost_ledger_to_lots     AS cost_ledger(LOT_ID)       REFERENCES lots(LOT_ID),
    invoices_to_shipments   AS invoices(SHIPMENT_ID)     REFERENCES shipments(SHIPMENT_ID),
    credit_notes_to_lots    AS credit_notes(LOT_ID)      REFERENCES lots(LOT_ID),
    settlements_to_lots     AS settlements(LOT_ID)       REFERENCES lots(LOT_ID)
  )

  FACTS (
    -- ---------------- lot grain ----------------
    lots.f_qty_kg                 AS QTY_KG
      COMMENT = 'Harvested quantity in kilograms',
    lots.f_excursion_hours        AS EXCURSION_HOURS
      COMMENT = 'Hours this lot spent above the 1.8 C organic blueberry pulp temperature threshold',
    lots.f_degree_hours_above     AS DEGREE_MINUTES_ABOVE / 60.0
      COMMENT = 'Degree-hours above the 1.8 C threshold. Captures excursion severity, not just duration',
    lots.f_compliant_minutes      AS COMPLIANT_MINUTES
      COMMENT = 'Sensor minutes at or below 1.8 C',
    lots.f_total_sensor_minutes   AS TOTAL_SENSOR_MINUTES
      COMMENT = 'Total sensor minutes recorded for this lot',
    lots.f_firmness_loss_pct      AS FIRMNESS_LOSS_PCT
      COMMENT = 'Fractional firmness loss from the initial reading',
    lots.f_shelf_life_lost        AS SHELF_LIFE_DAYS_LOST
      COMMENT = 'Days of shelf life lost to cold chain excursions',
    lots.f_shelf_life_effective   AS SHELF_LIFE_DAYS_EFFECTIVE
      COMMENT = 'Remaining saleable shelf life in days after cold chain losses',
    lots.f_shrink_pct             AS SHRINK_PCT
      COMMENT = 'Modelled cold chain shrink as a fraction of shipped weight',
    lots.f_product_value_usd      AS QTY_KG * GROWER_PRICE_PER_KG
      COMMENT = 'Grower-side product value of the lot in USD',

    -- Spoilage Risk Score components, 0-100 total. PRIVATE: these are
    -- building blocks and must never be queried as standalone numbers.
    PRIVATE lots.f_risk_excursion     AS LEAST((DEGREE_MINUTES_ABOVE / 60.0) * 6.0, 45.0)
      COMMENT = 'Risk points from excursion severity, max 45',
    PRIVATE lots.f_risk_firmness      AS LEAST(FIRMNESS_LOSS_PCT * 180.0, 25.0)
      COMMENT = 'Risk points from firmness degradation, max 25',
    PRIVATE lots.f_risk_shelf_life    AS LEAST(DIV0(SHELF_LIFE_DAYS_LOST, SHELF_LIFE_DAYS_BASE) * 100.0 * 0.30, 20.0)
      COMMENT = 'Risk points from shelf life erosion, max 20',
    PRIVATE lots.f_risk_noncompliance AS LEAST((1 - DIV0(COMPLIANT_MINUTES, TOTAL_SENSOR_MINUTES)) * 100.0 * 0.10, 10.0)
      COMMENT = 'Risk points from time out of temperature compliance, max 10',
    PRIVATE lots.f_spoilage_points    AS LEAST(
        LEAST((DEGREE_MINUTES_ABOVE / 60.0) * 6.0, 45.0)
      + LEAST(FIRMNESS_LOSS_PCT * 180.0, 25.0)
      + LEAST(DIV0(SHELF_LIFE_DAYS_LOST, SHELF_LIFE_DAYS_BASE) * 100.0 * 0.30, 20.0)
      + LEAST((1 - DIV0(COMPLIANT_MINUTES, TOTAL_SENSOR_MINUTES)) * 100.0 * 0.10, 10.0), 100.0)
      COMMENT = 'Row level spoilage risk points for a single lot, 0-100',
    PRIVATE lots.f_spoilage_points_wt AS LEAST(
        LEAST((DEGREE_MINUTES_ABOVE / 60.0) * 6.0, 45.0)
      + LEAST(FIRMNESS_LOSS_PCT * 180.0, 25.0)
      + LEAST(DIV0(SHELF_LIFE_DAYS_LOST, SHELF_LIFE_DAYS_BASE) * 100.0 * 0.30, 20.0)
      + LEAST((1 - DIV0(COMPLIANT_MINUTES, TOTAL_SENSOR_MINUTES)) * 100.0 * 0.10, 10.0), 100.0) * QTY_KG
      COMMENT = 'Spoilage risk points weighted by lot quantity, used to aggregate risk across lots',

    -- ---------------- shipment grain ----------------
    shipments.f_shipped_kg            AS SHIPPED_KG
      COMMENT = 'Quantity despatched in kilograms',
    shipments.f_delivered_sellable_kg AS DELIVERED_SELLABLE_KG
      COMMENT = 'Quantity actually sellable on arrival after modelled cold chain shrink',
    shipments.f_shrink_kg             AS SHRINK_KG
      COMMENT = 'Kilograms lost to cold chain shrink on this shipment',
    shipments.f_freight_cost_usd      AS FREIGHT_COST_USD
      COMMENT = 'Freight cost for this shipment in USD',
    shipments.f_energy_kwh            AS TOTAL_ENERGY_KWH
      COMMENT = 'Reefer energy consumed on this shipment in kWh',
    shipments.f_breach_readings       AS BREACH_READINGS
      COMMENT = 'Reefer telemetry readings above 1.8 C return air',
    shipments.f_telemetry_readings    AS TELEMETRY_READINGS
      COMMENT = 'Total reefer telemetry readings on this shipment',
    shipments.f_delay_hours           AS ARRIVAL_DELAY_HOURS
      COMMENT = 'Hours late against the promised arrival. Negative means early',
    PRIVATE shipments.f_arrived       AS CASE WHEN ACTUAL_ARRIVAL_TS IS NOT NULL THEN 1 ELSE 0 END
      COMMENT = 'Flag: shipment has arrived',
    -- An arrival only counts as on time if it is BOTH punctual AND still
    -- carries enough shelf life for a retailer to accept it. 7 days is the
    -- governed standard retailer minimum.
    PRIVATE shipments.f_otd_qualified AS CASE
        WHEN ACTUAL_ARRIVAL_TS IS NOT NULL
         AND IS_ON_TIME = 1
         AND SHELF_LIFE_DAYS_EFFECTIVE >= 7
        THEN 1 ELSE 0 END
      COMMENT = 'Flag: arrived on time AND with at least 7 days of usable shelf life',

    -- ---------------- inventory grain (snapshot) ----------------
    inventory.f_on_hand_kg      AS ON_HAND_KG
      COMMENT = 'Kilograms physically on hand at the snapshot date',
    inventory.f_committed_kg    AS COMMITTED_KG
      COMMENT = 'Kilograms already committed to orders',
    inventory.f_hold_kg         AS HOLD_KG
      COMMENT = 'Kilograms under quality hold and therefore not sellable',
    inventory.f_daily_demand_kg AS AVG_DAILY_DEMAND_KG
      COMMENT = 'Average daily demand in kilograms, used as the DOI denominator',
    PRIVATE inventory.f_atp_kg  AS GREATEST(ON_HAND_KG - COMMITTED_KG - HOLD_KG, 0)
      COMMENT = 'Row level quality-adjusted available-to-promise: on hand less committed less held',

    -- ---------------- order line grain ----------------
    po_lines.f_ordered_kg  AS ORDERED_KG
      COMMENT = 'Kilograms ordered by the retailer',
    po_lines.f_shipped_kg  AS SHIPPED_KG
      COMMENT = 'Kilograms despatched against this line',
    po_lines.f_accepted_kg AS ACCEPTED_KG
      COMMENT = 'Kilograms accepted by the retailer after quality inspection',
    po_lines.f_line_value_usd AS ORDERED_KG * UNIT_PRICE_USD
      COMMENT = 'Gross value of the order line in USD',

    -- ---------------- finance grain ----------------
    cost_ledger.f_cost_usd    AS AMOUNT_USD
      COMMENT = 'A single posted cost amount in USD',
    PRIVATE cost_ledger.f_cost_product AS CASE WHEN COST_TYPE = 'PRODUCT' THEN AMOUNT_USD ELSE 0 END,
    PRIVATE cost_ledger.f_cost_freight AS CASE WHEN COST_TYPE = 'FREIGHT' THEN AMOUNT_USD ELSE 0 END,
    PRIVATE cost_ledger.f_cost_energy  AS CASE WHEN COST_TYPE = 'ENERGY'  THEN AMOUNT_USD ELSE 0 END,
    PRIVATE cost_ledger.f_cost_shrink  AS CASE WHEN COST_TYPE = 'SHRINK'  THEN AMOUNT_USD ELSE 0 END,
    PRIVATE cost_ledger.f_cost_claim   AS CASE WHEN COST_TYPE = 'CLAIM'   THEN AMOUNT_USD ELSE 0 END,

    invoices.f_gross_usd  AS GROSS_AMOUNT_USD
      COMMENT = 'Invoice gross amount in USD',
    invoices.f_shrink_deduction_usd AS SHRINK_DEDUCTION_USD
      COMMENT = 'Shrink deduction applied to the invoice in USD',
    invoices.f_net_usd    AS NET_AMOUNT_USD
      COMMENT = 'Invoice net amount in USD',
    invoices.f_invoiced_kg AS INVOICED_KG
      COMMENT = 'Kilograms billed on the invoice',

    credit_notes.f_credit_usd AS AMOUNT_USD
      COMMENT = 'Credit note amount in USD',

    settlements.f_settlement_net_usd AS NET_AMOUNT_USD
      COMMENT = 'Net amount payable to the grower in USD',
    settlements.f_quality_deduction_usd AS QUALITY_DEDUCTION_USD
      COMMENT = 'Quality deduction withheld from the grower in USD',
    settlements.f_accepted_kg AS ACCEPTED_KG
      COMMENT = 'Kilograms accepted and paid for',
    settlements.f_rejected_kg AS REJECTED_KG
      COMMENT = 'Kilograms rejected and not paid for'
  )

  DIMENSIONS (
    -- ---------------- lot ----------------
    lots.d_lot_id        AS LOT_ID
      WITH SYNONYMS = ('lot', 'lot number', 'lot id')
      COMMENT = 'Harvest lot identifier, format LOT-YYYYMMDD-<ranch>-<block>',
    lots.d_variety       AS VARIETY
      WITH SYNONYMS = ('cultivar', 'berry variety')
      COMMENT = 'Blueberry variety'
      SAMPLE_VALUES ('Emerald', 'Duke', 'Jewel', 'Star') IS_ENUM,
    lots.d_lot_status    AS LOT_STATUS
      WITH SYNONYMS = ('status', 'lot state')
      COMMENT = 'Lot disposition'
      SAMPLE_VALUES ('AVAILABLE', 'HOLD', 'RELEASED', 'DIVERTED', 'CONSUMED') IS_ENUM,
    lots.d_hold_reason   AS HOLD_REASON
      COMMENT = 'Why the lot is on hold, if it is',
    lots.d_harvest_ts    AS HARVEST_TS
      WITH SYNONYMS = ('harvest time', 'picked at')
      COMMENT = 'Timestamp the lot was harvested',
    lots.d_harvest_date  AS HARVEST_TS::DATE
      WITH SYNONYMS = ('harvest day', 'pick date')
      COMMENT = 'Calendar date the lot was harvested',
    lots.d_is_harvested_today LABELS = (FILTER) AS HARVEST_TS::DATE = CURRENT_DATE()
      COMMENT = 'Filter: lot was harvested today',
    lots.d_ranch_name    AS RANCH_NAME
      WITH SYNONYMS = ('ranch', 'farm name')
      COMMENT = 'Ranch the lot came from',
    lots.d_ranch_id      AS RANCH_ID
      COMMENT = 'Ranch identifier, format RANCH-NN',
    lots.d_block_name    AS BLOCK_NAME
      WITH SYNONYMS = ('block', 'field')
      COMMENT = 'Planting block within the ranch, for example Block 7',
    lots.d_block_id      AS BLOCK_ID
      COMMENT = 'Block identifier, format B-<ranch>-<block>',
    lots.d_grower_name   AS GROWER_NAME
      WITH SYNONYMS = ('grower', 'supplier')
      COMMENT = 'Grower responsible for the lot',
    lots.d_region        AS REGION
      COMMENT = 'Growing region',
    lots.d_organic_cert  AS ORGANIC_CERT_ID
      COMMENT = 'USDA organic certification identifier',
    -- Operational risk band derived from the single canonical risk formula
    lots.d_risk_band     AS CASE
        WHEN lots.f_spoilage_points >= 60 THEN 'CRITICAL'
        WHEN lots.f_spoilage_points >= 35 THEN 'HIGH'
        WHEN lots.f_spoilage_points >= 15 THEN 'MODERATE'
        ELSE 'LOW' END
      WITH SYNONYMS = ('risk band', 'risk category', 'spoilage band')
      COMMENT = 'Spoilage risk band derived from the Spoilage Risk Score'
      SAMPLE_VALUES ('LOW', 'MODERATE', 'HIGH', 'CRITICAL') IS_ENUM,
    lots.d_has_excursion LABELS = (FILTER) AS EXCURSION_HOURS > 0
      COMMENT = 'Filter: lot experienced at least one temperature excursion',

    -- ---------------- shipment ----------------
    shipments.d_shipment_id AS SHIPMENT_ID
      WITH SYNONYMS = ('shipment', 'load')
      COMMENT = 'Shipment identifier',
    shipments.d_carrier     AS CARRIER
      COMMENT = 'Carrier moving the shipment',
    shipments.d_reefer_id   AS REEFER_ID
      WITH SYNONYMS = ('reefer', 'trailer', 'refrigeration unit')
      COMMENT = 'Reefer unit identifier',
    shipments.d_status      AS STATUS
      COMMENT = 'Shipment status'
      SAMPLE_VALUES ('IN_TRANSIT', 'ARRIVED', 'DIVERTED', 'CANCELLED') IS_ENUM,
    shipments.d_arrival_date AS ARRIVAL_DATE
      WITH SYNONYMS = ('arrival day', 'delivered on', 'received date')
      COMMENT = 'Calendar date the shipment arrived at the DC',
    shipments.d_arrived_yesterday LABELS = (FILTER) AS ARRIVAL_DATE = DATEADD('day', -1, CURRENT_DATE())
      COMMENT = 'Filter: shipment arrived at the DC yesterday',
    shipments.d_depart_ts   AS DEPART_TS
      COMMENT = 'Timestamp the shipment departed the ranch',
    shipments.d_promised_arrival_ts AS PROMISED_ARRIVAL_TS
      COMMENT = 'Timestamp the shipment was promised to arrive',
    shipments.d_actual_arrival_ts   AS ACTUAL_ARRIVAL_TS
      COMMENT = 'Timestamp the shipment actually arrived',

    -- ---------------- dc ----------------
    dcs.d_dc_code AS DC_CODE
      WITH SYNONYMS = ('DC', 'distribution centre code')
      COMMENT = 'Distribution centre code'
      SAMPLE_VALUES ('TRACY-DC', 'SALINAS-DC', 'RENO-DC', 'PHOENIX-DC') IS_ENUM,
    dcs.d_dc_name AS DC_NAME
      WITH SYNONYMS = ('distribution centre', 'warehouse name')
      COMMENT = 'Distribution centre name, for example Tracy Distribution Center',
    dcs.d_dc_region AS REGION
      COMMENT = 'Region the DC serves',

    -- ---------------- inventory ----------------
    inventory.d_snapshot_date AS SNAPSHOT_DATE
      WITH SYNONYMS = ('as of date', 'stock date', 'inventory date')
      COMMENT = 'Date of the inventory snapshot. Inventory must never be summed across this dimension',
    inventory.d_inventory_dc  AS DC_CODE
      COMMENT = 'DC holding the stock',

    -- ---------------- order ----------------
    po_lines.d_po_line_id AS PO_LINE_ID
      COMMENT = 'Purchase order line identifier',
    po_lines.d_po_id      AS PO_ID
      WITH SYNONYMS = ('PO', 'order number')
      COMMENT = 'Purchase order identifier',
    po_lines.d_line_variety AS VARIETY
      COMMENT = 'Variety requested on the order line',
    po_lines.d_fill_status AS FILL_STATUS
      COMMENT = 'Fill status of the order line'
      SAMPLE_VALUES ('PENDING', 'FILLED', 'SHORT', 'CANCELLED') IS_ENUM,
    po_lines.d_min_shelf_life_days AS MIN_SHELF_LIFE_DAYS
      COMMENT = 'Minimum shelf life in days the retailer will accept on this line',
    retailer_pos.d_retailer_name AS RETAILER_NAME
      WITH SYNONYMS = ('retailer', 'customer')
      COMMENT = 'Retailer that placed the order',
    retailer_pos.d_po_status AS STATUS
      COMMENT = 'Purchase order status'
      SAMPLE_VALUES ('OPEN', 'CLOSED', 'CANCELLED') IS_ENUM,
    retailer_pos.d_requested_delivery_ts AS REQUESTED_DELIVERY_TS
      COMMENT = 'Timestamp the retailer requested delivery',

    -- ---------------- finance ----------------
    cost_ledger.d_cost_type AS COST_TYPE
      WITH SYNONYMS = ('cost category', 'cost bucket')
      COMMENT = 'Cost component type that rolls into True Landed Cost'
      SAMPLE_VALUES ('PRODUCT', 'FREIGHT', 'ENERGY', 'SHRINK', 'CLAIM') IS_ENUM,
    cost_ledger.d_cost_posted_ts AS POSTED_TS
      COMMENT = 'When the cost was posted to the ledger',
    invoices.d_invoice_id AS INVOICE_ID
      WITH SYNONYMS = ('invoice', 'invoice number')
      COMMENT = 'Invoice identifier',
    invoices.d_invoice_date AS INVOICE_DATE
      COMMENT = 'Invoice date',
    invoices.d_invoice_status AS STATUS
      COMMENT = 'Invoice status'
      SAMPLE_VALUES ('ISSUED', 'PAID', 'CANCELLED') IS_ENUM,
    credit_notes.d_credit_note_id AS CREDIT_NOTE_ID
      COMMENT = 'Credit note identifier',
    credit_notes.d_credit_reason AS REASON_CODE
      COMMENT = 'Reason the credit note was raised',
    credit_notes.d_credit_is_provisional AS IS_PROVISIONAL
      COMMENT = 'TRUE while the credit note is provisional and not yet settled',
    credit_notes.d_credit_status AS STATUS
      COMMENT = 'Credit note status'
      SAMPLE_VALUES ('PROVISIONAL', 'FINAL', 'CANCELLED') IS_ENUM,
    settlements.d_settlement_id AS SETTLEMENT_ID
      COMMENT = 'Grower settlement identifier',
    settlements.d_settlement_status AS STATUS
      COMMENT = 'Settlement status'
      SAMPLE_VALUES ('DRAFT', 'SETTLED', 'CANCELLED') IS_ENUM,
    settlements.d_settlement_date AS SETTLEMENT_DATE
      COMMENT = 'Date the grower settlement was raised'
  )

  METRICS (
    -- =================================================================
    -- CANONICAL METRIC 1 of 7: Spoilage Risk Score
    -- =================================================================
    lots.SPOILAGE_RISK_SCORE AS
      ROUND(DIV0(SUM(lots.f_spoilage_points_wt), SUM(lots.f_qty_kg)), 1)
      WITH SYNONYMS = ('spoilage risk', 'risk score', 'spoilage score', 'spoilage risk score')
      COMMENT = 'CANONICAL. Quantity-weighted spoilage risk on a 0-100 scale. Combines excursion severity (max 45 points), firmness loss (max 25), shelf-life erosion (max 20) and time out of temperature compliance (max 10). Weighted by lot quantity so a large at-risk lot outranks a small one. 60+ is CRITICAL, 35-59 HIGH, 15-34 MODERATE, below 15 LOW',

    -- =================================================================
    -- CANONICAL METRIC 2 of 7: Temperature Compliance %
    -- =================================================================
    lots.TEMPERATURE_COMPLIANCE_PCT AS
      ROUND(100.0 * DIV0(SUM(lots.f_compliant_minutes), SUM(lots.f_total_sensor_minutes)), 2)
      WITH SYNONYMS = ('temperature compliance', 'temp compliance', 'cold chain compliance', 'compliance percent')
      COMMENT = 'CANONICAL. Percentage of recorded sensor minutes at or below the 1.8 C organic blueberry pulp temperature threshold. Minute-weighted, so lots with more telemetry contribute proportionally',

    -- =================================================================
    -- CANONICAL METRIC 3 of 7: Shelf-Life-Adjusted OTD
    -- =================================================================
    shipments.SHELF_LIFE_ADJUSTED_OTD AS
      ROUND(100.0 * DIV0(SUM(shipments.f_otd_qualified), SUM(shipments.f_arrived)), 2)
      WITH SYNONYMS = ('shelf life adjusted OTD', 'quality OTD', 'adjusted on time delivery', 'OTD')
      COMMENT = 'CANONICAL. Percentage of arrived shipments that were BOTH delivered on or before the promised time AND arrived with at least 7 days of usable shelf life. A punctual delivery that has burned its shelf life does not count as on time',

    -- =================================================================
    -- CANONICAL METRIC 4 of 7: Quality-Adjusted Fill Rate
    -- =================================================================
    po_lines.QUALITY_ADJUSTED_FILL_RATE AS
      ROUND(100.0 * DIV0(SUM(po_lines.f_accepted_kg), SUM(po_lines.f_ordered_kg)), 2)
      WITH SYNONYMS = ('quality adjusted fill rate', 'fill rate', 'accepted fill rate', 'service level')
      COMMENT = 'CANONICAL. Kilograms accepted by the retailer after quality inspection divided by kilograms ordered. Uses accepted rather than shipped quantity, so product rejected at intake correctly counts as a miss',

    -- =================================================================
    -- CANONICAL METRIC 5 of 7: True Landed Cost
    -- =================================================================
    cost_ledger.TRUE_LANDED_COST AS ROUND(SUM(cost_ledger.f_cost_usd), 2)
      WITH SYNONYMS = ('true landed cost', 'landed cost', 'fully loaded cost', 'total landed cost')
      COMMENT = 'CANONICAL. Fully loaded cost in USD: product plus freight plus reefer energy plus cold chain shrink plus quality claims. This is the only landed cost figure anyone should quote',

    cost_ledger.m_cost_product AS ROUND(SUM(cost_ledger.f_cost_product), 2)
      COMMENT = 'Product component of True Landed Cost',
    cost_ledger.m_cost_freight AS ROUND(SUM(cost_ledger.f_cost_freight), 2)
      COMMENT = 'Freight component of True Landed Cost',
    cost_ledger.m_cost_energy  AS ROUND(SUM(cost_ledger.f_cost_energy), 2)
      COMMENT = 'Reefer energy component of True Landed Cost',
    cost_ledger.m_cost_shrink  AS ROUND(SUM(cost_ledger.f_cost_shrink), 2)
      COMMENT = 'Cold chain shrink component of True Landed Cost',
    cost_ledger.m_cost_claim   AS ROUND(SUM(cost_ledger.f_cost_claim), 2)
      COMMENT = 'Quality claim component of True Landed Cost',

    -- =================================================================
    -- CANONICAL METRIC 6 of 7: Live DOI  (SEMI-ADDITIVE)
    -- CANONICAL METRIC 7 of 7: ATP, quality adjusted (SEMI-ADDITIVE)
    --
    -- NON ADDITIVE BY (d_snapshot_date) is essential. INVENTORY is a
    -- daily snapshot: without this the engine sums stock across every
    -- snapshot date and availability is overstated by a factor equal to
    -- the number of days in range.
    -- =================================================================
    inventory.m_on_hand_kg
      NON ADDITIVE BY (d_snapshot_date)
      AS ROUND(SUM(inventory.f_on_hand_kg), 2)
      WITH SYNONYMS = ('on hand', 'stock on hand', 'inventory on hand')
      COMMENT = 'Kilograms on hand at the latest snapshot in range. Semi-additive: never summed across snapshot dates',

    inventory.m_daily_demand_kg
      NON ADDITIVE BY (d_snapshot_date)
      AS ROUND(SUM(inventory.f_daily_demand_kg), 2)
      COMMENT = 'Average daily demand in kilograms at the latest snapshot in range',

    inventory.ATP_QUALITY_ADJUSTED
      NON ADDITIVE BY (d_snapshot_date)
      AS ROUND(SUM(inventory.f_atp_kg), 2)
      WITH SYNONYMS = ('ATP', 'available to promise', 'quality adjusted ATP', 'availability')
      COMMENT = 'CANONICAL. Quality-adjusted available-to-promise in kilograms: on hand less committed less quantity under quality hold, at the latest snapshot. Semi-additive, so it reflects current availability rather than a sum across days. Held stock is excluded, which is what makes it quality adjusted',

    inventory.m_hold_kg
      NON ADDITIVE BY (d_snapshot_date)
      AS ROUND(SUM(inventory.f_hold_kg), 2)
      COMMENT = 'Kilograms under quality hold at the latest snapshot',

    inventory.m_committed_kg
      NON ADDITIVE BY (d_snapshot_date)
      AS ROUND(SUM(inventory.f_committed_kg), 2)
      COMMENT = 'Kilograms committed to orders at the latest snapshot',

    -- Derived: only derived metrics may reference semi-additive metrics
    LIVE_DOI AS ROUND(DIV0(inventory.m_on_hand_kg, inventory.m_daily_demand_kg), 2)
      WITH SYNONYMS = ('DOI', 'days of inventory', 'days on hand', 'live DOI', 'days of supply')
      COMMENT = 'CANONICAL. Live days of inventory: on-hand kilograms divided by average daily demand, computed from the latest inventory snapshot. Semi-additive inputs mean this is a true current position, not an average across days',

    ATP_DAYS_OF_COVER AS ROUND(DIV0(inventory.ATP_QUALITY_ADJUSTED, inventory.m_daily_demand_kg), 2)
      COMMENT = 'Days of cover available from quality-adjusted ATP only',

    -- ---------------- supporting operational metrics ----------------
    lots.m_lot_count AS COUNT(DISTINCT lots.d_lot_id)
      COMMENT = 'Number of distinct harvest lots',
    lots.m_total_harvested_kg AS ROUND(SUM(lots.f_qty_kg), 2)
      COMMENT = 'Total harvested kilograms',
    lots.m_max_excursion_hours AS ROUND(MAX(lots.f_excursion_hours), 2)
      COMMENT = 'Worst single-lot excursion duration in hours',
    lots.m_avg_excursion_hours AS ROUND(AVG(lots.f_excursion_hours), 2)
      COMMENT = 'Average excursion duration in hours across lots',
    lots.m_total_degree_hours AS ROUND(SUM(lots.f_degree_hours_above), 2)
      COMMENT = 'Total degree-hours above the 1.8 C threshold',
    lots.m_min_shelf_life_effective AS ROUND(MIN(lots.f_shelf_life_effective), 2)
      COMMENT = 'Shortest remaining effective shelf life in days',
    lots.m_avg_shelf_life_effective AS ROUND(AVG(lots.f_shelf_life_effective), 2)
      COMMENT = 'Average remaining effective shelf life in days',
    lots.m_product_value_usd AS ROUND(SUM(lots.f_product_value_usd), 2)
      COMMENT = 'Grower-side product value of the lots in USD',
    lots.m_avg_firmness_loss_pct AS ROUND(100.0 * AVG(lots.f_firmness_loss_pct), 2)
      COMMENT = 'Average firmness loss as a percentage',
    lots.m_avg_shrink_pct AS ROUND(100.0 * AVG(lots.f_shrink_pct), 2)
      COMMENT = 'Average modelled cold chain shrink as a percentage',

    shipments.m_shipment_count AS COUNT(DISTINCT shipments.d_shipment_id)
      COMMENT = 'Number of distinct shipments',
    shipments.m_shipped_kg AS ROUND(SUM(shipments.f_shipped_kg), 2)
      COMMENT = 'Total kilograms despatched',
    shipments.m_delivered_sellable_kg AS ROUND(SUM(shipments.f_delivered_sellable_kg), 2)
      COMMENT = 'Total sellable kilograms delivered after shrink',
    shipments.m_shrink_kg AS ROUND(SUM(shipments.f_shrink_kg), 2)
      COMMENT = 'Total kilograms lost to cold chain shrink',
    shipments.m_freight_cost_usd AS ROUND(SUM(shipments.f_freight_cost_usd), 2)
      COMMENT = 'Total freight cost in USD',
    shipments.m_energy_kwh AS ROUND(SUM(shipments.f_energy_kwh), 2)
      COMMENT = 'Total reefer energy in kWh',
    shipments.m_avg_delay_hours AS ROUND(AVG(shipments.f_delay_hours), 2)
      COMMENT = 'Average arrival delay in hours against promise',
    shipments.m_reefer_breach_pct AS
      ROUND(100.0 * DIV0(SUM(shipments.f_breach_readings), SUM(shipments.f_telemetry_readings)), 2)
      COMMENT = 'Percentage of reefer telemetry readings above 1.8 C return air',

    po_lines.m_ordered_kg AS ROUND(SUM(po_lines.f_ordered_kg), 2)
      COMMENT = 'Total kilograms ordered',
    po_lines.m_accepted_kg AS ROUND(SUM(po_lines.f_accepted_kg), 2)
      COMMENT = 'Total kilograms accepted',
    po_lines.m_shortfall_kg AS ROUND(SUM(po_lines.f_ordered_kg) - SUM(po_lines.f_accepted_kg), 2)
      COMMENT = 'Kilograms ordered but not accepted',
    po_lines.m_order_value_usd AS ROUND(SUM(po_lines.f_line_value_usd), 2)
      COMMENT = 'Gross order value in USD',

    invoices.m_invoice_count AS COUNT(DISTINCT invoices.d_invoice_id)
      COMMENT = 'Number of invoices',
    invoices.m_invoiced_gross_usd AS ROUND(SUM(invoices.f_gross_usd), 2)
      COMMENT = 'Total invoiced gross in USD',
    invoices.m_invoiced_net_usd AS ROUND(SUM(invoices.f_net_usd), 2)
      COMMENT = 'Total invoiced net in USD',
    invoices.m_shrink_deduction_usd AS ROUND(SUM(invoices.f_shrink_deduction_usd), 2)
      COMMENT = 'Total shrink deductions applied to invoices in USD',

    credit_notes.m_credit_total_usd AS ROUND(SUM(credit_notes.f_credit_usd), 2)
      COMMENT = 'Total credit notes raised in USD',
    credit_notes.m_credit_count AS COUNT(DISTINCT credit_notes.d_credit_note_id)
      COMMENT = 'Number of credit notes',

    settlements.m_settlement_net_usd AS ROUND(SUM(settlements.f_settlement_net_usd), 2)
      COMMENT = 'Total net payable to growers in USD',
    settlements.m_quality_deduction_usd AS ROUND(SUM(settlements.f_quality_deduction_usd), 2)
      COMMENT = 'Total quality deductions withheld from growers in USD',
    settlements.m_rejected_kg AS ROUND(SUM(settlements.f_rejected_kg), 2)
      COMMENT = 'Total kilograms rejected at grower settlement'
  )

  COMMENT = 'BlueberryChain OS governed semantic view. The single source of truth for the organic blueberry farm-to-retail cold chain. Defines the seven canonical metrics (Spoilage Risk Score, Temperature Compliance %, Shelf-Life-Adjusted OTD, Quality-Adjusted Fill Rate, True Landed Cost, Live DOI, quality-adjusted ATP) exactly once, so every agent and every persona returns identical values.'

  AI_SQL_GENERATION 'Units and rounding: quantities are kilograms, money is USD, temperatures are degrees Celsius, durations are hours. Round money to 2 decimals, percentages to 2 decimals, risk scores to 1 decimal. The organic blueberry pulp temperature threshold is 1.8 C - never use any other threshold. Always prefer the canonical metrics SPOILAGE_RISK_SCORE, TEMPERATURE_COMPLIANCE_PCT, SHELF_LIFE_ADJUSTED_OTD, QUALITY_ADJUSTED_FILL_RATE, TRUE_LANDED_COST, LIVE_DOI and ATP_QUALITY_ADJUSTED over recomputing anything from facts. Never sum inventory on-hand, ATP or demand across d_snapshot_date; those metrics are semi-additive and already return the latest snapshot. When a question says "this morning" or "today" filter on lots.d_harvest_date = CURRENT_DATE(). When a question says "yesterday" for a delivery or arrival, filter on shipments.d_arrival_date = DATEADD(day, -1, CURRENT_DATE()). Ranch references like "Ranch 14" map to lots.d_ranch_id = RANCH-14 and block references like "Block 7" map to lots.d_block_name = Block 7. Exclude lots with d_lot_status of CONSUMED or DIVERTED from availability questions unless the user explicitly asks for them.'

  AI_QUESTION_CATEGORIZATION 'This semantic view covers the organic blueberry supply chain only: harvest, cold chain, quality, inventory, orders, logistics and the finance that follows from them. If a question asks about a lot-level or block-level metric without naming a ranch, block or lot, ask which ranch or block is meant rather than aggregating across the whole estate. If a question asks for a spoilage or risk figure without a time frame, assume lots harvested in the last 7 days and say so. Reject questions about employees, payroll, HR or anything outside the blueberry supply chain and tell the user this view covers supply chain data only.'

  AI_VERIFIED_QUERIES (
    hero_lot_excursion AS (
      QUESTION 'What is the spoilage risk score and temperature compliance for Ranch 14 Block 7 lots harvested today?'
      VERIFIED_AT 1790000000
      ONBOARDING_QUESTION TRUE
      VERIFIED_BY '(STEWARD = cold_chain_team)'
      SQL 'SELECT * FROM SEMANTIC_VIEW( ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT, lots.m_max_excursion_hours, lots.m_total_harvested_kg
             DIMENSIONS lots.d_lot_id, lots.d_ranch_name, lots.d_block_name, lots.d_variety
             WHERE lots.d_ranch_id = ''RANCH-14'' AND lots.d_block_name = ''Block 7'' AND lots.d_harvest_date = CURRENT_DATE() )'
    ),
    tracy_arrivals_yesterday AS (
      QUESTION 'Which shipments arrived at Tracy DC yesterday and what is their true landed cost?'
      VERIFIED_AT 1790000000
      ONBOARDING_QUESTION TRUE
      VERIFIED_BY '(STEWARD = finance_team)'
      SQL 'SELECT * FROM SEMANTIC_VIEW( ORGANIC_BLUEBERRY_CHAIN
             METRICS shipments.m_shipment_count, shipments.m_shipped_kg, shipments.m_delivered_sellable_kg, shipments.m_shrink_kg
             DIMENSIONS shipments.d_shipment_id, shipments.d_arrival_date, dcs.d_dc_name
             WHERE dcs.d_dc_code = ''TRACY-DC'' AND shipments.d_arrival_date = DATEADD(''day'', -1, CURRENT_DATE()) )'
    ),
    live_availability AS (
      QUESTION 'What is the current quality adjusted ATP and live days of inventory by variety at Tracy DC?'
      VERIFIED_AT 1790000000
      ONBOARDING_QUESTION TRUE
      VERIFIED_BY '(STEWARD = inventory_team)'
      SQL 'SELECT * FROM SEMANTIC_VIEW( ORGANIC_BLUEBERRY_CHAIN
             METRICS inventory.ATP_QUALITY_ADJUSTED, LIVE_DOI, inventory.m_on_hand_kg, inventory.m_hold_kg
             DIMENSIONS lots.d_variety, dcs.d_dc_code
             WHERE dcs.d_dc_code = ''TRACY-DC'' )'
    )
  );

-- ---------------------------------------------------------------------
-- Grants: agents need SELECT on the semantic view only, not base tables
-- ---------------------------------------------------------------------
GRANT SELECT ON SEMANTIC VIEW SEMANTIC.ORGANIC_BLUEBERRY_CHAIN TO ROLE BBC_AGENT_ROLE;
GRANT SELECT ON SEMANTIC VIEW SEMANTIC.ORGANIC_BLUEBERRY_CHAIN TO ROLE BBC_HARVEST_ROLE;
GRANT SELECT ON SEMANTIC VIEW SEMANTIC.ORGANIC_BLUEBERRY_CHAIN TO ROLE BBC_LOGISTICS_ROLE;
GRANT SELECT ON SEMANTIC VIEW SEMANTIC.ORGANIC_BLUEBERRY_CHAIN TO ROLE BBC_QUALITY_ROLE;
GRANT SELECT ON SEMANTIC VIEW SEMANTIC.ORGANIC_BLUEBERRY_CHAIN TO ROLE BBC_FINANCE_ROLE;
GRANT USAGE ON DATABASE BLUEBERRY_CHAIN TO ROLE BBC_HARVEST_ROLE;
GRANT USAGE ON DATABASE BLUEBERRY_CHAIN TO ROLE BBC_LOGISTICS_ROLE;
GRANT USAGE ON DATABASE BLUEBERRY_CHAIN TO ROLE BBC_QUALITY_ROLE;
GRANT USAGE ON DATABASE BLUEBERRY_CHAIN TO ROLE BBC_FINANCE_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.SEMANTIC TO ROLE BBC_HARVEST_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.SEMANTIC TO ROLE BBC_LOGISTICS_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.SEMANTIC TO ROLE BBC_QUALITY_ROLE;
GRANT USAGE ON SCHEMA BLUEBERRY_CHAIN.SEMANTIC TO ROLE BBC_FINANCE_ROLE;
GRANT USAGE ON WAREHOUSE BBC_WH TO ROLE BBC_HARVEST_ROLE;
GRANT USAGE ON WAREHOUSE BBC_WH TO ROLE BBC_LOGISTICS_ROLE;
GRANT USAGE ON WAREHOUSE BBC_WH TO ROLE BBC_QUALITY_ROLE;
GRANT USAGE ON WAREHOUSE BBC_WH TO ROLE BBC_FINANCE_ROLE;
GRANT ROLE BBC_HARVEST_ROLE   TO ROLE ACCOUNTADMIN;
GRANT ROLE BBC_LOGISTICS_ROLE TO ROLE ACCOUNTADMIN;
GRANT ROLE BBC_QUALITY_ROLE   TO ROLE ACCOUNTADMIN;
GRANT ROLE BBC_FINANCE_ROLE   TO ROLE ACCOUNTADMIN;

SELECT 'SEMANTIC VIEW CREATED' AS STATUS;
