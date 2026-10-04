-- =====================================================================
-- BlueberryChain OS - 07 Proof Queries
--
-- Mechanical proof that there is ONE source of truth.
--
-- PROOF 1: four different persona roles run the identical semantic-view
--          query and get byte-identical metric values. Asserted, not
--          eyeballed: COUNT(DISTINCT value) must be 1 per metric.
-- PROOF 2: every autonomous action carries the exact metric values it
--          read, naming the semantic view.
-- PROOF 3: the semi-additive guard works - inventory metrics return the
--          latest snapshot, not a sum across snapshot dates.
-- PROOF 4: the 7 canonical metrics all exist in the semantic view.
-- PROOF 5: autonomy policy is enforced - high-value actions queued.
-- PROOF 6: the Supervisor's agent_toolset references all resolve.
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE WAREHOUSE BBC_WH;

-- =====================================================================
-- PROOF 4 (run first - establishes the metrics exist)
-- All 7 canonical metrics are defined in the semantic view.
-- =====================================================================
SELECT '=== PROOF 4: canonical metrics defined once ===' AS PROOF;

-- Ask the semantic view what metrics it actually exposes.
SHOW SEMANTIC METRICS IN BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN;

WITH required AS (
    SELECT 'SPOILAGE_RISK_SCORE'        AS METRIC UNION ALL
    SELECT 'TEMPERATURE_COMPLIANCE_PCT'          UNION ALL
    SELECT 'SHELF_LIFE_ADJUSTED_OTD'             UNION ALL
    SELECT 'QUALITY_ADJUSTED_FILL_RATE'          UNION ALL
    SELECT 'TRUE_LANDED_COST'                    UNION ALL
    SELECT 'LIVE_DOI'                            UNION ALL
    SELECT 'ATP_QUALITY_ADJUSTED'
),
defined AS (
    SELECT "name" AS METRIC, COUNT(*) AS DEFINITIONS
      FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
     GROUP BY "name"
)
SELECT r.METRIC,
       COALESCE(d.DEFINITIONS, 0) AS TIMES_DEFINED,
       CASE WHEN COALESCE(d.DEFINITIONS,0) = 1 THEN 'PASS - defined exactly once'
            WHEN COALESCE(d.DEFINITIONS,0) = 0 THEN 'FAIL - missing'
            ELSE 'FAIL - defined more than once' END AS RESULT
  FROM required r
  LEFT JOIN defined d ON d.METRIC = r.METRIC
 ORDER BY r.METRIC;

-- =====================================================================
-- PROOF 1: every persona sees identical metric values.
--
-- The same query is executed under four different roles. Harvest,
-- Logistics, Quality and Finance each hold SELECT on the semantic view
-- and nothing else - they cannot even read the base tables, so they
-- have no way to compute a different number.
-- =====================================================================
SELECT '=== PROOF 1: side-by-side persona comparison ===' AS PROOF;

-- The collection table must be writable by each persona role, so it is a
-- real table with explicit grants rather than a TEMPORARY table (a temp
-- table is owned by the creating role and the persona roles could not
-- insert into it).
CREATE OR REPLACE TABLE BLUEBERRY_CHAIN.APP.PERSONA_PROOF (
    PERSONA        VARCHAR,
    ROLE_USED      VARCHAR,
    LOT_ID         VARCHAR,
    SPOILAGE_RISK_SCORE        NUMBER(10,2),
    TEMPERATURE_COMPLIANCE_PCT NUMBER(10,2),
    EXCURSION_HOURS            NUMBER(10,2),
    HARVESTED_KG               NUMBER(14,2)
);

GRANT USAGE  ON SCHEMA BLUEBERRY_CHAIN.APP TO ROLE BBC_HARVEST_ROLE;
GRANT USAGE  ON SCHEMA BLUEBERRY_CHAIN.APP TO ROLE BBC_LOGISTICS_ROLE;
GRANT USAGE  ON SCHEMA BLUEBERRY_CHAIN.APP TO ROLE BBC_QUALITY_ROLE;
GRANT USAGE  ON SCHEMA BLUEBERRY_CHAIN.APP TO ROLE BBC_FINANCE_ROLE;
GRANT INSERT, SELECT ON TABLE BLUEBERRY_CHAIN.APP.PERSONA_PROOF TO ROLE BBC_HARVEST_ROLE;
GRANT INSERT, SELECT ON TABLE BLUEBERRY_CHAIN.APP.PERSONA_PROOF TO ROLE BBC_LOGISTICS_ROLE;
GRANT INSERT, SELECT ON TABLE BLUEBERRY_CHAIN.APP.PERSONA_PROOF TO ROLE BBC_QUALITY_ROLE;
GRANT INSERT, SELECT ON TABLE BLUEBERRY_CHAIN.APP.PERSONA_PROOF TO ROLE BBC_FINANCE_ROLE;

-- ---- Harvest persona ----
USE ROLE BBC_HARVEST_ROLE;
INSERT INTO BLUEBERRY_CHAIN.APP.PERSONA_PROOF
SELECT 'Ranch / Harvest Manager', CURRENT_ROLE(), D_LOT_ID,
       SPOILAGE_RISK_SCORE, TEMPERATURE_COMPLIANCE_PCT,
       M_MAX_EXCURSION_HOURS, M_TOTAL_HARVESTED_KG
  FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
         METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                 lots.m_max_excursion_hours, lots.m_total_harvested_kg
         DIMENSIONS lots.d_lot_id )
 WHERE D_LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-14-07';

-- ---- Logistics persona ----
USE ROLE BBC_LOGISTICS_ROLE;
INSERT INTO BLUEBERRY_CHAIN.APP.PERSONA_PROOF
SELECT 'Logistics / Cold Chain', CURRENT_ROLE(), D_LOT_ID,
       SPOILAGE_RISK_SCORE, TEMPERATURE_COMPLIANCE_PCT,
       M_MAX_EXCURSION_HOURS, M_TOTAL_HARVESTED_KG
  FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
         METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                 lots.m_max_excursion_hours, lots.m_total_harvested_kg
         DIMENSIONS lots.d_lot_id )
 WHERE D_LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-14-07';

-- ---- Quality persona ----
USE ROLE BBC_QUALITY_ROLE;
INSERT INTO BLUEBERRY_CHAIN.APP.PERSONA_PROOF
SELECT 'Quality Gate', CURRENT_ROLE(), D_LOT_ID,
       SPOILAGE_RISK_SCORE, TEMPERATURE_COMPLIANCE_PCT,
       M_MAX_EXCURSION_HOURS, M_TOTAL_HARVESTED_KG
  FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
         METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                 lots.m_max_excursion_hours, lots.m_total_harvested_kg
         DIMENSIONS lots.d_lot_id )
 WHERE D_LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-14-07';

-- ---- Finance persona ----
USE ROLE BBC_FINANCE_ROLE;
INSERT INTO BLUEBERRY_CHAIN.APP.PERSONA_PROOF
SELECT 'Finance / Billing', CURRENT_ROLE(), D_LOT_ID,
       SPOILAGE_RISK_SCORE, TEMPERATURE_COMPLIANCE_PCT,
       M_MAX_EXCURSION_HOURS, M_TOTAL_HARVESTED_KG
  FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
         METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                 lots.m_max_excursion_hours, lots.m_total_harvested_kg
         DIMENSIONS lots.d_lot_id )
 WHERE D_LOT_ID = 'LOT-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-14-07';

USE ROLE ACCOUNTADMIN;

-- Side by side
SELECT * FROM BLUEBERRY_CHAIN.APP.PERSONA_PROOF ORDER BY PERSONA;

-- The assertion that matters
SELECT 'SPOILAGE_RISK_SCORE'        AS METRIC,
       COUNT(DISTINCT SPOILAGE_RISK_SCORE) AS DISTINCT_VALUES,
       MAX(SPOILAGE_RISK_SCORE)::VARCHAR   AS AGREED_VALUE,
       CASE WHEN COUNT(DISTINCT SPOILAGE_RISK_SCORE) = 1
            THEN 'PASS - all personas agree' ELSE 'FAIL - personas disagree' END AS RESULT
  FROM BLUEBERRY_CHAIN.APP.PERSONA_PROOF
UNION ALL
SELECT 'TEMPERATURE_COMPLIANCE_PCT',
       COUNT(DISTINCT TEMPERATURE_COMPLIANCE_PCT),
       MAX(TEMPERATURE_COMPLIANCE_PCT)::VARCHAR,
       CASE WHEN COUNT(DISTINCT TEMPERATURE_COMPLIANCE_PCT) = 1
            THEN 'PASS - all personas agree' ELSE 'FAIL - personas disagree' END
  FROM BLUEBERRY_CHAIN.APP.PERSONA_PROOF
UNION ALL
SELECT 'EXCURSION_HOURS',
       COUNT(DISTINCT EXCURSION_HOURS),
       MAX(EXCURSION_HOURS)::VARCHAR,
       CASE WHEN COUNT(DISTINCT EXCURSION_HOURS) = 1
            THEN 'PASS - all personas agree' ELSE 'FAIL - personas disagree' END
  FROM BLUEBERRY_CHAIN.APP.PERSONA_PROOF
UNION ALL
SELECT 'HARVESTED_KG',
       COUNT(DISTINCT HARVESTED_KG),
       MAX(HARVESTED_KG)::VARCHAR,
       CASE WHEN COUNT(DISTINCT HARVESTED_KG) = 1
            THEN 'PASS - all personas agree' ELSE 'FAIL - personas disagree' END
  FROM BLUEBERRY_CHAIN.APP.PERSONA_PROOF;

-- Personas also cannot bypass the view: they hold SELECT on the semantic
-- view only, with no grants on RAW or CURATED, so there is no second path
-- to the data from which a different number could be produced.
SELECT '=== PROOF 1b: personas cannot bypass the semantic view ===' AS PROOF;

SHOW GRANTS TO ROLE BBC_FINANCE_ROLE;
SELECT "privilege", "granted_on", "name"
  FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
 ORDER BY "granted_on", "name";

-- =====================================================================
-- PROOF 2: every autonomous action is linked to the metric values it
-- actually read, naming the semantic view.
-- =====================================================================
SELECT '=== PROOF 2: audit trail metric provenance ===' AS PROOF;

SELECT COUNT(*)                                            AS TOTAL_ACTIONS,
       COUNT(DISTINCT AGENT_NAME)                          AS AGENTS_INVOLVED,
       COUNT(DISTINCT TOOL_NAME)                           AS TOOLS_USED,
       SUM(CASE WHEN METRIC_SNAPSHOT IS NULL THEN 1 ELSE 0 END) AS MISSING_SNAPSHOT,
       SUM(CASE WHEN METRIC_SNAPSHOT:semantic_view::VARCHAR
                     = 'BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN'
                THEN 1 ELSE 0 END)                         AS NAMES_SEMANTIC_VIEW,
       CASE WHEN SUM(CASE WHEN METRIC_SNAPSHOT IS NULL THEN 1 ELSE 0 END) = 0
            THEN 'PASS - every action carries its metric snapshot'
            ELSE 'FAIL - some actions have no provenance' END AS RESULT
  FROM BLUEBERRY_CHAIN.AUDIT.DECISION_LOG;

-- Full decision trail, newest first
SELECT CREATED_AT, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       AUTONOMY_LEVEL, APPROVAL_STATUS,
       METRIC_SNAPSHOT:SPOILAGE_RISK_SCORE::VARCHAR        AS SPOILAGE_RISK,
       METRIC_SNAPSHOT:TEMPERATURE_COMPLIANCE_PCT::VARCHAR AS TEMP_COMPLIANCE,
       METRIC_SNAPSHOT:semantic_view::VARCHAR              AS SOURCE_OF_TRUTH,
       RESULT_SUMMARY
  FROM BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
 ORDER BY CREATED_AT DESC
 LIMIT 40;

-- Cross-check: the risk score recorded by the agent at decision time
-- equals the value the semantic view returns for that lot right now.
SELECT '=== PROOF 2b: recorded value matches the view ===' AS PROOF;

WITH recorded AS (
    SELECT ENTITY_ID AS LOT_ID,
           MAX(METRIC_SNAPSHOT:SPOILAGE_RISK_SCORE::NUMBER(10,2)) AS RECORDED_RISK
      FROM BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
     WHERE TOOL_NAME = 'HOLD_LOT' AND ENTITY_TYPE = 'LOT'
     GROUP BY ENTITY_ID
),
live AS (
    SELECT D_LOT_ID AS LOT_ID, SPOILAGE_RISK_SCORE AS LIVE_RISK
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE
             DIMENSIONS lots.d_lot_id )
)
SELECT r.LOT_ID, r.RECORDED_RISK, l.LIVE_RISK,
       CASE WHEN r.RECORDED_RISK = l.LIVE_RISK
            THEN 'PASS - audit value matches the semantic view'
            ELSE 'DIFFERS - underlying data changed since the decision' END AS RESULT
  FROM recorded r JOIN live l ON l.LOT_ID = r.LOT_ID;

-- =====================================================================
-- PROOF 3: semi-additive inventory metrics do not inflate.
--
-- Without NON ADDITIVE BY (d_snapshot_date) the engine would sum stock
-- across every snapshot date and overstate availability by roughly the
-- number of days in range.
-- =====================================================================
SELECT '=== PROOF 3: semi-additive inventory guard ===' AS PROOF;

WITH per_date AS (
    SELECT D_SNAPSHOT_DATE, M_ON_HAND_KG, ATP_QUALITY_ADJUSTED
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS inventory.m_on_hand_kg, inventory.ATP_QUALITY_ADJUSTED
             DIMENSIONS inventory.d_snapshot_date, dcs.d_dc_code )
     WHERE D_DC_CODE = 'TRACY-DC'
),
aggregated AS (
    SELECT M_ON_HAND_KG AS AGG_ON_HAND, ATP_QUALITY_ADJUSTED AS AGG_ATP
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS inventory.m_on_hand_kg, inventory.ATP_QUALITY_ADJUSTED
             DIMENSIONS dcs.d_dc_code )
     WHERE D_DC_CODE = 'TRACY-DC'
)
SELECT
    (SELECT AGG_ON_HAND FROM aggregated)                            AS SEMANTIC_VIEW_ON_HAND,
    (SELECT MAX(M_ON_HAND_KG) FROM per_date
      WHERE D_SNAPSHOT_DATE = (SELECT MAX(D_SNAPSHOT_DATE) FROM per_date)) AS LATEST_SNAPSHOT_ON_HAND,
    (SELECT SUM(M_ON_HAND_KG) FROM per_date)                        AS NAIVE_SUM_ACROSS_DATES,
    (SELECT COUNT(*) FROM per_date)                                 AS SNAPSHOT_DATES,
    CASE WHEN (SELECT AGG_ON_HAND FROM aggregated)
              = (SELECT MAX(M_ON_HAND_KG) FROM per_date
                  WHERE D_SNAPSHOT_DATE = (SELECT MAX(D_SNAPSHOT_DATE) FROM per_date))
         THEN 'PASS - returns the latest snapshot, not a sum'
         ELSE 'FAIL - inventory is being summed across dates' END   AS RESULT;

-- =====================================================================
-- PROOF 5: autonomy policy is enforced server side.
-- =====================================================================
SELECT '=== PROOF 5: autonomy enforcement ===' AS PROOF;

SELECT TOOL_NAME, AUTONOMY_LEVEL, VALUE_THRESHOLD_USD, NOTES
  FROM BLUEBERRY_CHAIN.TOOLS.AUTONOMY_POLICY
 ORDER BY AUTONOMY_LEVEL, TOOL_NAME;

SELECT APPROVAL_ID, AGENT_NAME, TOOL_NAME, STATUS,
       ESTIMATED_VALUE_USD,
       METRIC_SNAPSHOT:semantic_view::VARCHAR AS SOURCE_OF_TRUTH,
       REQUESTED_AT, DECIDED_AT, DECISION_NOTE
  FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
 ORDER BY REQUESTED_AT DESC;

-- Nothing marked PENDING may have produced a side effect.
SELECT 'Pending approvals that leaked a side effect' AS CHECK_NAME,
       COUNT(*) AS LEAKS,
       CASE WHEN COUNT(*) = 0
            THEN 'PASS - queued actions did not execute'
            ELSE 'FAIL - a pending action was executed' END AS RESULT
  FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE q
 WHERE q.STATUS = 'PENDING'
   AND q.TOOL_NAME = 'CREATE_PO'
   AND EXISTS (SELECT 1 FROM BLUEBERRY_CHAIN.RAW.PROCUREMENT_POS p
                WHERE p.REASON LIKE '%' || q.APPROVAL_ID || '%');

-- =====================================================================
-- PROOF 6: the Supervisor's agent_toolset references all resolve.
--
-- A missing USAGE grant on a referenced agent is SILENTLY SKIPPED at run
-- time with no error, so this must be checked explicitly rather than
-- assumed from a successful agent run.
-- =====================================================================
SELECT '=== PROOF 6: agent toolset references resolve ===' AS PROOF;

SHOW AGENTS IN SCHEMA BLUEBERRY_CHAIN.TOOLS;

WITH expected AS (
    SELECT 'COLD_CHAIN_AGENT'    AS AGENT_NAME UNION ALL
    SELECT 'FINANCE_AGENT'                     UNION ALL
    SELECT 'QUALITY_GATE_AGENT'                UNION ALL
    SELECT 'INVENTORY_ATP_AGENT'               UNION ALL
    SELECT 'ORDER_PROMISE_AGENT'               UNION ALL
    SELECT 'HARVEST_AGENT'                     UNION ALL
    SELECT 'PROCUREMENT_AGENT'                 UNION ALL
    SELECT 'SUPERVISOR_AGENT'
),
actual AS (
    SELECT "name" AS AGENT_NAME FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
)
SELECT e.AGENT_NAME,
       CASE WHEN a.AGENT_NAME IS NULL
            THEN 'FAIL - agent missing, toolset would be silently skipped'
            ELSE 'PASS - agent exists' END AS RESULT
  FROM expected e
  LEFT JOIN actual a ON a.AGENT_NAME = e.AGENT_NAME
 ORDER BY e.AGENT_NAME;

-- Each specialist must be granted to the role that runs the Supervisor.
-- NOTE: SHOW GRANTS reports agents with granted_on = 'CORTEX_AGENT', not
-- 'AGENT'. Filtering on 'AGENT' silently returns nothing and makes a
-- correctly granted system look broken.
SHOW GRANTS TO ROLE BBC_AGENT_ROLE;
SELECT COUNT(*) AS AGENT_USAGE_GRANTS,
       CASE WHEN COUNT(*) >= 8
            THEN 'PASS - every toolset reference is authorised'
            ELSE 'FAIL - a reference will be silently skipped at run time' END AS RESULT
  FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
 WHERE "granted_on" = 'CORTEX_AGENT' AND "privilege" = 'USAGE';

-- =====================================================================
-- PROOF 7: the demo data matches the requested narrative.
-- =====================================================================
SELECT '=== PROOF 7: Costco PO present and exposed ===' AS PROOF;

SELECT p.PO_ID, p.RETAILER_NAME, p.DC_CODE, p.STATUS,
       l.PO_LINE_ID, l.VARIETY, l.ORDERED_KG, l.FILL_STATUS,
       CASE WHEN p.PO_ID = 'PO-6001' AND l.VARIETY = 'Emerald'
                 AND l.FILL_STATUS = 'PENDING' AND l.ORDERED_KG > 0
            THEN 'PASS - Costco Emerald exposure ready for Demo 1'
            ELSE 'CHECK - review' END AS RESULT
  FROM BLUEBERRY_CHAIN.RAW.RETAILER_POS p
  JOIN BLUEBERRY_CHAIN.RAW.PO_LINES l ON l.PO_ID = p.PO_ID
 WHERE p.PO_ID = 'PO-6001'
 ORDER BY l.PO_LINE_ID;

-- =====================================================================
-- PROOF 8: finance tools return real, downloadable documents.
-- A document is only "real" if PDF_B64 is populated and decodes to the
-- %PDF header (base64 of '%PDF' begins with 'JVBERi').
-- =====================================================================
SELECT '=== PROOF 8: downloadable documents are real PDFs ===' AS PROOF;

SELECT COUNT(*) AS INVOICES_WITH_PDF,
       SUM(CASE WHEN PDF_B64 LIKE 'JVBERi%' THEN 1 ELSE 0 END) AS VALID_PDF,
       CASE WHEN COUNT(*) = 0 THEN 'SKIP - no invoices yet (run Demo 2)'
            WHEN SUM(CASE WHEN PDF_B64 LIKE 'JVBERi%' THEN 1 ELSE 0 END) = COUNT(*)
            THEN 'PASS - every new invoice carries a valid PDF'
            ELSE 'FAIL - some invoices have no valid PDF' END AS RESULT
  FROM BLUEBERRY_CHAIN.RAW.INVOICES
 WHERE DOC_TITLE IS NOT NULL;

SELECT COUNT(*) AS CREDIT_NOTES_WITH_PDF,
       SUM(CASE WHEN PDF_B64 LIKE 'JVBERi%' THEN 1 ELSE 0 END) AS VALID_PDF,
       CASE WHEN COUNT(*) = 0 THEN 'SKIP - no credit notes yet (run Demo 1)'
            WHEN SUM(CASE WHEN PDF_B64 LIKE 'JVBERi%' THEN 1 ELSE 0 END) = COUNT(*)
            THEN 'PASS - every credit note carries a valid PDF'
            ELSE 'FAIL - some credit notes have no valid PDF' END AS RESULT
  FROM BLUEBERRY_CHAIN.RAW.CREDIT_NOTES
 WHERE DOC_TITLE IS NOT NULL;

-- =====================================================================
-- PROOF 9: money survives every hand-off at full precision.
-- A bare NUMBER parameter or ::NUMBER cast is NUMBER(38,0) and silently
-- rounds 7.10 to 7. This caught exactly that bug in CREATE_PO,
-- GENERATE_INVOICE and APPROVE_ACTION.
-- =====================================================================
SELECT '=== PROOF 9: prices are not rounded in transit ===' AS PROOF;

SELECT COUNT(*) AS EXECUTED_APPROVED_POS,
       SUM(IFF(p.UNIT_PRICE_USD = q.ACTION_PAYLOAD:unit_price_usd::NUMBER(10,4)
               AND p.TOTAL_VALUE_USD = q.ESTIMATED_VALUE_USD, 1, 0)) AS EXACT_MATCH,
       CASE WHEN COUNT(*) = 0 THEN 'SKIP - no approved PO yet (approve one to exercise this)'
            WHEN EXACT_MATCH = COUNT(*) THEN 'PASS - issued PO equals queued price and value'
            ELSE 'FAIL - price or value changed between queue and execution' END AS RESULT
  FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE q
  JOIN BLUEBERRY_CHAIN.RAW.PROCUREMENT_POS p ON p.REASON = 'Approved via ' || q.APPROVAL_ID
 WHERE q.TOOL_NAME = 'CREATE_PO' AND q.STATUS = 'EXECUTED';

SELECT COUNT(*) AS INVOICES,
       SUM(IFF(ROUND(GROSS_AMOUNT_USD / NULLIF(INVOICED_KG, 0), 2) = FLOOR(GROSS_AMOUNT_USD / NULLIF(INVOICED_KG, 0)), 1, 0)) AS WHOLE_DOLLAR_PRICE,
       CASE WHEN COUNT(*) = 0 THEN 'SKIP - no invoices yet (run Demo 2)'
            WHEN WHOLE_DOLLAR_PRICE = 0 THEN 'PASS - invoice unit prices keep their cents (11.20, not 11)'
            ELSE 'FAIL - some invoices were priced at a rounded whole-dollar rate' END AS RESULT
  FROM BLUEBERRY_CHAIN.RAW.INVOICES;

SELECT '=== ALL PROOFS COMPLETE ===' AS STATUS;
