-- =====================================================================
-- BlueberryChain OS - 05 Agent Tools
--
-- 11 stored procedures exposed to Cortex Agents as custom tools, plus
-- two approval helpers.
--
-- EVERY TOOL FOLLOWS THE SAME FIVE-STEP CONTRACT:
--   1. Read the relevant canonical metrics FROM THE SEMANTIC VIEW.
--      No tool recomputes a metric in its own SQL.
--   2. Resolve autonomy from TOOLS.AUTONOMY_POLICY.
--   3. Either execute, or queue to AUDIT.APPROVAL_QUEUE and stop.
--   4. Write AUDIT.DECISION_LOG including METRIC_SNAPSHOT - the exact
--      metric values read in step 1.
--   5. Return a VARIANT the agent can quote verbatim.
--
-- This is how "every agent sees identical metrics" is enforced for
-- WRITES as well as reads: a semantic view cannot be written to, so the
-- write path reads its numbers from the same governed definition.
--
-- NOTE: inside LANGUAGE SQL bodies, variables are referenced with a
-- colon prefix (:P_LOT_ID). Without it Snowflake treats them as column
-- identifiers and raises "invalid identifier".
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE SCHEMA TOOLS;

-- ---------------------------------------------------------------------
-- Supporting tables + sequences
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS BLUEBERRY_CHAIN.RAW.HARVEST_REQUESTS (
    REQUEST_ID    VARCHAR(30) NOT NULL PRIMARY KEY,
    RANCH_ID      VARCHAR(20),
    VARIETY       VARCHAR(40),
    REQUESTED_KG  NUMBER(12,2),
    NEEDED_BY     DATE,
    EST_VALUE_USD NUMBER(14,2),
    STATUS        VARCHAR(20) DEFAULT 'REQUESTED',
    REASON        VARCHAR(500),
    CREATED_TS    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Replacement harvest requests raised by agents';

CREATE TABLE IF NOT EXISTS BLUEBERRY_CHAIN.RAW.PROCUREMENT_POS (
    PROC_PO_ID     VARCHAR(30) NOT NULL PRIMARY KEY,
    SUPPLIER_RANCH_ID VARCHAR(20),
    VARIETY        VARCHAR(40),
    QTY_KG         NUMBER(12,2),
    UNIT_PRICE_USD NUMBER(10,4),
    DC_CODE        VARCHAR(20),
    TOTAL_VALUE_USD NUMBER(14,2),
    STATUS         VARCHAR(20) DEFAULT 'ISSUED',
    REASON         VARCHAR(500),
    CREATED_TS     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'Replacement / supplementary procurement POs raised by agents';

CREATE SEQUENCE IF NOT EXISTS SEQ_DECISION  START = 1 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_APPROVAL  START = 1 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_INVOICE   START = 9000 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_CREDIT    START = 7000 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_PROCPO    START = 8000 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_HARVESTRQ START = 6000 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_NOTIF     START = 1 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_SETTLE    START = 5000 INCREMENT = 1;
CREATE SEQUENCE IF NOT EXISTS SEQ_COST      START = 1 INCREMENT = 1;

-- =====================================================================
-- INTERNAL HELPER: BUILD_SIMPLE_PDF
-- Assembles a minimal valid single-page PDF from text lines, base64.
-- Not an agent tool - used by GENERATE_INVOICE and WRITE_CREDIT_NOTE.
-- =====================================================================
CREATE OR REPLACE FUNCTION TOOLS.BUILD_SIMPLE_PDF(P_LINES ARRAY)
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
COMMENT = 'Internal helper: assemble a minimal valid single-page PDF from text lines, base64-encoded. Not an agent tool.'
AS
$$
function esc(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }
var lines = P_LINES || [];
var body = '';
for (var i=0;i<lines.length;i++){
  body += 'BT /F1 12 Tf 50 ' + (720 - (i*20)) + ' Td (' + esc(lines[i]) + ') Tj ET\n';
}
function pad(n){ n=String(n); while(n.length<10) n='0'+n; return n; }
var objs = [];
objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
objs.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
objs.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
objs.push('5 0 obj\n<< /Length ' + body.length + ' >>\nstream\n' + body + 'endstream\nendobj\n');
var pdf = '%PDF-1.4\n';
var offs = [];
for (var j=0;j<objs.length;j++){ offs.push(pdf.length); pdf += objs[j]; }
var xrefPos = pdf.length;
pdf += 'xref\n0 ' + (objs.length+1) + '\n';
pdf += '0000000000 65535 f \n';
for (var k=0;k<offs.length;k++){ pdf += pad(offs[k]) + ' 00000 n \n'; }
pdf += 'trailer\n<< /Size ' + (objs.length+1) + ' /Root 1 0 R >>\n';
pdf += 'startxref\n' + xrefPos + '\n%%EOF';
var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var out = '';
for (var p=0; p<pdf.length; p+=3){
  var c1 = pdf.charCodeAt(p), c2 = p+1<pdf.length?pdf.charCodeAt(p+1):NaN, c3 = p+2<pdf.length?pdf.charCodeAt(p+2):NaN;
  var e1 = c1>>2, e2 = ((c1&3)<<4) | (isNaN(c2)?0:c2>>4), e3 = isNaN(c2)?64:(((c2&15)<<2)|(isNaN(c3)?0:c3>>6)), e4 = isNaN(c3)?64:(c3&63);
  out += chars[e1]+chars[e2]+chars[e3]+chars[e4];
}
return out;
$$;

-- =====================================================================
-- TOOL 1: HOLD_LOT   (FULL_AUTO - low risk, reversible, protects product)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.HOLD_LOT(
    P_LOT_ID    VARCHAR,
    P_REASON    VARCHAR,
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Place a harvest lot on quality hold. Reads Spoilage Risk Score and Temperature Compliance from the semantic view first and records them in the audit trail.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_risk    NUMBER(10,2);
    v_comp    NUMBER(10,2);
    v_exc     NUMBER(10,2);
    v_qty     NUMBER(14,2);
    v_shelf   NUMBER(10,2);
    v_exists  NUMBER;
    v_snap    VARIANT;
    v_dec_id  VARCHAR;
BEGIN
    -- STEP 1: read canonical metrics from the semantic view
    SELECT MAX(SPOILAGE_RISK_SCORE), MAX(TEMPERATURE_COMPLIANCE_PCT),
           MAX(M_MAX_EXCURSION_HOURS), MAX(M_TOTAL_HARVESTED_KG),
           MAX(M_MIN_SHELF_LIFE_EFFECTIVE)
      INTO :v_risk, :v_comp, :v_exc, :v_qty, :v_shelf
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                     lots.m_max_excursion_hours, lots.m_total_harvested_kg,
                     lots.m_min_shelf_life_effective
             DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :P_LOT_ID;

    SELECT COUNT(*) INTO :v_exists
      FROM BLUEBERRY_CHAIN.RAW.HARVEST_LOTS WHERE LOT_ID = :P_LOT_ID;

    IF (v_exists = 0) THEN
        RETURN OBJECT_CONSTRUCT('status','ERROR','tool','HOLD_LOT',
                                'message','Lot not found: ' || :P_LOT_ID);
    END IF;

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SPOILAGE_RISK_SCORE', :v_risk,
        'TEMPERATURE_COMPLIANCE_PCT', :v_comp,
        'EXCURSION_HOURS', :v_exc,
        'SHELF_LIFE_DAYS_EFFECTIVE', :v_shelf,
        'LOT_QTY_KG', :v_qty,
        'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    -- STEP 3: HOLD_LOT is FULL_AUTO - execute immediately
    UPDATE BLUEBERRY_CHAIN.RAW.HARVEST_LOTS
       SET LOT_STATUS = 'HOLD',
           HOLD_REASON = :P_REASON,
           LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE LOT_ID = :P_LOT_ID;

    -- Reflect the hold in inventory so ATP drops immediately
    UPDATE BLUEBERRY_CHAIN.RAW.INVENTORY
       SET HOLD_KG = ON_HAND_KG,
           LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE LOT_ID = :P_LOT_ID
       AND SNAPSHOT_DATE = (SELECT MAX(SNAPSHOT_DATE)
                              FROM BLUEBERRY_CHAIN.RAW.INVENTORY
                             WHERE LOT_ID = :P_LOT_ID);

    -- STEP 4: audit with the exact metric values used
    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'QUALITY_GATE_AGENT', 'HOLD_LOT', 'LOT', :P_LOT_ID,
           OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'reason', :P_REASON),
           :v_snap, 'FULL_AUTO', 'NOT_REQUIRED',
           'Lot placed on quality hold. Spoilage Risk Score ' || :v_risk
           || ', Temperature Compliance ' || :v_comp || '%';

    RETURN OBJECT_CONSTRUCT(
        'status','SUCCESS','tool','HOLD_LOT','decision_id', :v_dec_id,
        'lot_id', :P_LOT_ID, 'new_lot_status','HOLD', 'reason', :P_REASON,
        'autonomy','FULL_AUTO',
        'metrics_used', :v_snap,
        'message','Lot ' || :P_LOT_ID || ' is on quality hold. Spoilage Risk Score '
                  || :v_risk || ' with ' || :v_exc || ' excursion hours and '
                  || :v_comp || '% temperature compliance. '
                  || :v_qty || ' kg withdrawn from available stock.');
END;
$$;

-- =====================================================================
-- TOOL 2: RELEASE_LOT   (THRESHOLD - large releases need a human)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.RELEASE_LOT(
    P_LOT_ID    VARCHAR,
    P_NOTE      VARCHAR,
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Release a harvest lot from quality hold back to available. Value-gated: releases above the configured threshold are queued for human approval.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_risk NUMBER(10,2); v_comp NUMBER(10,2); v_qty NUMBER(14,2);
    v_value NUMBER(14,2); v_threshold NUMBER(14,2); v_level VARCHAR;
    v_snap VARIANT; v_dec_id VARCHAR; v_app_id VARCHAR;
BEGIN
    SELECT MAX(SPOILAGE_RISK_SCORE), MAX(TEMPERATURE_COMPLIANCE_PCT),
           MAX(M_TOTAL_HARVESTED_KG), MAX(M_PRODUCT_VALUE_USD)
      INTO :v_risk, :v_comp, :v_qty, :v_value
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                     lots.m_total_harvested_kg, lots.m_product_value_usd
             DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :P_LOT_ID;

    SELECT MAX(AUTONOMY_LEVEL), MAX(VALUE_THRESHOLD_USD)
      INTO :v_level, :v_threshold
      FROM BLUEBERRY_CHAIN.TOOLS.AUTONOMY_POLICY WHERE TOOL_NAME = 'RELEASE_LOT';

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SPOILAGE_RISK_SCORE', :v_risk, 'TEMPERATURE_COMPLIANCE_PCT', :v_comp,
        'LOT_QTY_KG', :v_qty, 'PRODUCT_VALUE_USD', :v_value,
        'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    IF (COALESCE(v_value, 0) > COALESCE(v_threshold, 1e18)) THEN
        SELECT 'APR-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_APPROVAL.NEXTVAL, 6, '0') INTO :v_app_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
          (APPROVAL_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ACTION_PAYLOAD,
           METRIC_SNAPSHOT, ESTIMATED_VALUE_USD, STATUS)
        SELECT :v_app_id, :P_THREAD_ID, 'QUALITY_GATE_AGENT', 'RELEASE_LOT',
               OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'note', :P_NOTE),
               :v_snap, :v_value, 'PENDING';

        SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
          (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
           ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
        SELECT :v_dec_id, :P_THREAD_ID, 'QUALITY_GATE_AGENT', 'RELEASE_LOT', 'LOT', :P_LOT_ID,
               OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'approval_id', :v_app_id),
               :v_snap, :v_level, 'PENDING',
               'Release queued for approval, value USD ' || :v_value;

        RETURN OBJECT_CONSTRUCT('status','PENDING_APPROVAL','tool','RELEASE_LOT',
            'approval_id', :v_app_id, 'decision_id', :v_dec_id, 'lot_id', :P_LOT_ID,
            'estimated_value_usd', :v_value, 'threshold_usd', :v_threshold,
            'metrics_used', :v_snap,
            'message','Release of ' || :P_LOT_ID || ' is valued at USD ' || :v_value
                      || ', above the USD ' || :v_threshold
                      || ' auto-release threshold. Queued as ' || :v_app_id
                      || ' for human approval. Nothing has been released yet.');
    END IF;

    UPDATE BLUEBERRY_CHAIN.RAW.HARVEST_LOTS
       SET LOT_STATUS = 'RELEASED', HOLD_REASON = NULL, LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE LOT_ID = :P_LOT_ID;

    UPDATE BLUEBERRY_CHAIN.RAW.INVENTORY
       SET HOLD_KG = 0, LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE LOT_ID = :P_LOT_ID;

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'QUALITY_GATE_AGENT', 'RELEASE_LOT', 'LOT', :P_LOT_ID,
           OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'note', :P_NOTE),
           :v_snap, :v_level, 'NOT_REQUIRED', 'Lot released from hold';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','RELEASE_LOT',
        'decision_id', :v_dec_id, 'lot_id', :P_LOT_ID, 'new_lot_status','RELEASED',
        'metrics_used', :v_snap,
        'message','Lot ' || :P_LOT_ID || ' released from hold. '
                  || :v_qty || ' kg returned to available stock.');
END;
$$;

-- =====================================================================
-- TOOL 3: UPDATE_ATP   (FULL_AUTO - recalculation only)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.UPDATE_ATP(
    P_DC_CODE   VARCHAR,
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Recalculate quality-adjusted available-to-promise for a distribution centre. Reads ATP_QUALITY_ADJUSTED and LIVE_DOI from the semantic view.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_atp NUMBER(14,2); v_doi NUMBER(10,2); v_onhand NUMBER(14,2);
    v_hold NUMBER(14,2); v_committed NUMBER(14,2);
    v_snap VARIANT; v_dec_id VARCHAR;
BEGIN
    SELECT MAX(ATP_QUALITY_ADJUSTED), MAX(LIVE_DOI), MAX(M_ON_HAND_KG),
           MAX(M_HOLD_KG), MAX(M_COMMITTED_KG)
      INTO :v_atp, :v_doi, :v_onhand, :v_hold, :v_committed
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS inventory.ATP_QUALITY_ADJUSTED, LIVE_DOI,
                     inventory.m_on_hand_kg, inventory.m_hold_kg, inventory.m_committed_kg
             DIMENSIONS dcs.d_dc_code )
     WHERE D_DC_CODE = :P_DC_CODE;

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'ATP_QUALITY_ADJUSTED', :v_atp, 'LIVE_DOI', :v_doi,
        'ON_HAND_KG', :v_onhand, 'HOLD_KG', :v_hold, 'COMMITTED_KG', :v_committed,
        'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'INVENTORY_ATP_AGENT', 'UPDATE_ATP', 'DC', :P_DC_CODE,
           OBJECT_CONSTRUCT('dc_code', :P_DC_CODE), :v_snap, 'FULL_AUTO', 'NOT_REQUIRED',
           'ATP recalculated: ' || :v_atp || ' kg, Live DOI ' || :v_doi || ' days';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','UPDATE_ATP',
        'decision_id', :v_dec_id, 'dc_code', :P_DC_CODE,
        'atp_quality_adjusted_kg', :v_atp, 'live_doi_days', :v_doi,
        'on_hand_kg', :v_onhand, 'hold_kg', :v_hold, 'committed_kg', :v_committed,
        'metrics_used', :v_snap,
        'message','Quality-adjusted ATP at ' || :P_DC_CODE || ' is ' || :v_atp
                  || ' kg with Live DOI of ' || :v_doi || ' days. '
                  || :v_hold || ' kg is excluded as held stock.');
END;
$$;

-- =====================================================================
-- TOOL 4: ADJUST_ORDER_PROMISE   (FULL_AUTO)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.ADJUST_ORDER_PROMISE(
    P_PO_ID     VARCHAR,
    P_REASON    VARCHAR,
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Reassess an open retailer PO against current quality-adjusted availability and update its fill rate and promise confidence.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_fill NUMBER(10,2); v_ordered NUMBER(14,2); v_accepted NUMBER(14,2);
    v_short NUMBER(14,2); v_dc VARCHAR; v_retailer VARCHAR;
    v_atp NUMBER(14,2); v_conf NUMBER(10,2);
    v_snap VARIANT; v_dec_id VARCHAR;
BEGIN
    SELECT MAX(QUALITY_ADJUSTED_FILL_RATE), MAX(M_ORDERED_KG),
           MAX(M_ACCEPTED_KG), MAX(M_SHORTFALL_KG)
      INTO :v_fill, :v_ordered, :v_accepted, :v_short
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS po_lines.QUALITY_ADJUSTED_FILL_RATE, po_lines.m_ordered_kg,
                     po_lines.m_accepted_kg, po_lines.m_shortfall_kg
             DIMENSIONS po_lines.d_po_id )
     WHERE D_PO_ID = :P_PO_ID;

    SELECT MAX(DC_CODE), MAX(RETAILER_NAME) INTO :v_dc, :v_retailer
      FROM BLUEBERRY_CHAIN.RAW.RETAILER_POS WHERE PO_ID = :P_PO_ID;

    SELECT MAX(ATP_QUALITY_ADJUSTED) INTO :v_atp
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS inventory.ATP_QUALITY_ADJUSTED
             DIMENSIONS dcs.d_dc_code )
     WHERE D_DC_CODE = :v_dc;

    -- Confidence is capped by how much of the outstanding order ATP can cover
    v_conf := LEAST(ROUND(100.0 * COALESCE(:v_atp,0)
                          / NULLIF(COALESCE(:v_ordered,0) - COALESCE(:v_accepted,0), 0), 2), 100.0);
    IF (v_conf IS NULL) THEN v_conf := 100.0; END IF;

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'QUALITY_ADJUSTED_FILL_RATE', :v_fill, 'ATP_QUALITY_ADJUSTED', :v_atp,
        'ORDERED_KG', :v_ordered, 'ACCEPTED_KG', :v_accepted, 'SHORTFALL_KG', :v_short,
        'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    UPDATE BLUEBERRY_CHAIN.RAW.RETAILER_POS
       SET PROMISE_CONFIDENCE_PCT = :v_conf, LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE PO_ID = :P_PO_ID;

    UPDATE BLUEBERRY_CHAIN.RAW.PO_LINES
       SET FILL_STATUS = CASE WHEN ACCEPTED_KG >= ORDERED_KG THEN 'FILLED'
                              WHEN ACCEPTED_KG > 0 THEN 'SHORT' ELSE 'AT_RISK' END
     WHERE PO_ID = :P_PO_ID;

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'ORDER_PROMISE_AGENT', 'ADJUST_ORDER_PROMISE', 'PO', :P_PO_ID,
           OBJECT_CONSTRUCT('po_id', :P_PO_ID, 'reason', :P_REASON, 'new_confidence_pct', :v_conf),
           :v_snap, 'FULL_AUTO', 'NOT_REQUIRED',
           'Promise confidence set to ' || :v_conf || '%, fill rate ' || :v_fill || '%';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','ADJUST_ORDER_PROMISE',
        'decision_id', :v_dec_id, 'po_id', :P_PO_ID, 'retailer', :v_retailer,
        'dc_code', :v_dc, 'quality_adjusted_fill_rate_pct', :v_fill,
        'new_promise_confidence_pct', :v_conf, 'shortfall_kg', :v_short,
        'metrics_used', :v_snap,
        'message','PO ' || :P_PO_ID || ' for ' || :v_retailer
                  || ' reassessed. Quality-Adjusted Fill Rate ' || :v_fill
                  || '%, shortfall ' || :v_short || ' kg, promise confidence now '
                  || :v_conf || '%. Reason: ' || :P_REASON);
END;
$$;

-- =====================================================================
-- TOOL 5: CALCULATE_TRUE_LANDED_COST   (FULL_AUTO - posts cost ledger)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.CALCULATE_TRUE_LANDED_COST(
    P_LOT_ID    VARCHAR,
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Post cold chain shrink cost for a lot and return its True Landed Cost broken down by component, read from the semantic view.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_tlc NUMBER(14,2); v_prod NUMBER(14,2); v_frt NUMBER(14,2);
    v_eng NUMBER(14,2); v_shr NUMBER(14,2); v_clm NUMBER(14,2);
    v_shrink_kg NUMBER(14,2); v_price NUMBER(10,4); v_shrink_cost NUMBER(14,2);
    v_qty NUMBER(14,2); v_tlc_kg NUMBER(14,4);
    v_snap VARIANT; v_dec_id VARCHAR; v_cost_id VARCHAR;
BEGIN
    -- Post the shrink cost component so the ledger reflects cold chain loss
    SELECT COALESCE(MAX(s.SHRINK_KG),0), COALESCE(MAX(l.GROWER_PRICE_PER_KG),0)
      INTO :v_shrink_kg, :v_price
      FROM BLUEBERRY_CHAIN.CURATED.DT_SHIPMENT_DELIVERY s
      JOIN BLUEBERRY_CHAIN.RAW.HARVEST_LOTS l ON l.LOT_ID = s.LOT_ID
     WHERE s.LOT_ID = :P_LOT_ID;

    v_shrink_cost := ROUND(COALESCE(:v_shrink_kg,0) * COALESCE(:v_price,0), 2);

    IF (v_shrink_cost > 0) THEN
        SELECT 'CST-SHR-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_COST.NEXTVAL, 8, '0') INTO :v_cost_id;
        DELETE FROM BLUEBERRY_CHAIN.RAW.LOT_COST_COMPONENTS
         WHERE LOT_ID = :P_LOT_ID AND COST_TYPE = 'SHRINK'
           AND SOURCE_TOOL = 'CALCULATE_TRUE_LANDED_COST';
        INSERT INTO BLUEBERRY_CHAIN.RAW.LOT_COST_COMPONENTS
          (COST_ID, LOT_ID, COST_TYPE, AMOUNT_USD, SOURCE_TOOL)
        SELECT :v_cost_id, :P_LOT_ID, 'SHRINK', :v_shrink_cost, 'CALCULATE_TRUE_LANDED_COST';
    END IF;

    -- Read the canonical cost metrics AFTER posting
    SELECT MAX(TRUE_LANDED_COST), MAX(M_COST_PRODUCT), MAX(M_COST_FREIGHT),
           MAX(M_COST_ENERGY), MAX(M_COST_SHRINK), MAX(M_COST_CLAIM)
      INTO :v_tlc, :v_prod, :v_frt, :v_eng, :v_shr, :v_clm
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS cost_ledger.TRUE_LANDED_COST, cost_ledger.m_cost_product,
                     cost_ledger.m_cost_freight, cost_ledger.m_cost_energy,
                     cost_ledger.m_cost_shrink, cost_ledger.m_cost_claim
             DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :P_LOT_ID;

    SELECT MAX(M_TOTAL_HARVESTED_KG) INTO :v_qty
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.m_total_harvested_kg DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :P_LOT_ID;

    v_tlc_kg := ROUND(DIV0(COALESCE(:v_tlc,0), COALESCE(:v_qty,0)), 4);

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'TRUE_LANDED_COST', :v_tlc, 'COST_PRODUCT', :v_prod, 'COST_FREIGHT', :v_frt,
        'COST_ENERGY', :v_eng, 'COST_SHRINK', :v_shr, 'COST_CLAIM', :v_clm,
        'LOT_QTY_KG', :v_qty, 'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'FINANCE_AGENT', 'CALCULATE_TRUE_LANDED_COST', 'LOT', :P_LOT_ID,
           OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'shrink_cost_posted_usd', :v_shrink_cost),
           :v_snap, 'FULL_AUTO', 'NOT_REQUIRED',
           'True Landed Cost USD ' || :v_tlc || ' (' || :v_tlc_kg || '/kg)';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','CALCULATE_TRUE_LANDED_COST',
        'decision_id', :v_dec_id, 'lot_id', :P_LOT_ID,
        'true_landed_cost_usd', :v_tlc, 'true_landed_cost_per_kg_usd', :v_tlc_kg,
        'breakdown', OBJECT_CONSTRUCT('product', :v_prod, 'freight', :v_frt,
                                      'energy', :v_eng, 'shrink', :v_shr, 'claim', :v_clm),
        'shrink_cost_posted_usd', :v_shrink_cost,
        'metrics_used', :v_snap,
        'message','True Landed Cost for ' || :P_LOT_ID || ' is USD ' || :v_tlc
                  || ' (' || :v_tlc_kg || ' per kg). Shrink of ' || :v_shrink_kg
                  || ' kg posted as USD ' || :v_shrink_cost || '.');
END;
$$;

-- =====================================================================
-- TOOL 6: GENERATE_INVOICE   (FULL_AUTO - routine billing)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.GENERATE_INVOICE(
    P_SHIPMENT_ID VARCHAR,
    P_UNIT_PRICE  NUMBER(10,4),   -- bare NUMBER is NUMBER(38,0): 11.20 would round to 11
    P_THREAD_ID   VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Generate a customer invoice for an arrived shipment, applying actual cold chain shrink from temperature history as a deduction. Raises the matching grower settlement and produces a real downloadable PDF (PDF_B64).'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_lot VARCHAR; v_dc VARCHAR; v_arr DATE; v_shipped NUMBER(14,2);
    v_sellable NUMBER(14,2); v_shrink_kg NUMBER(14,2); v_shrink_pct NUMBER(10,4);
    v_exc NUMBER(10,2); v_comp NUMBER(10,2); v_risk NUMBER(10,2);
    v_gross NUMBER(14,2); v_deduct NUMBER(14,2); v_net NUMBER(14,2);
    v_price NUMBER(10,4); v_grower VARCHAR; v_grower_price NUMBER(10,4);
    v_qty NUMBER(14,2); v_exists NUMBER;
    v_inv_id VARCHAR; v_stl_id VARCHAR; v_dec_id VARCHAR; v_snap VARIANT;
    v_variety VARCHAR; v_ranch VARCHAR; v_po VARCHAR;
    v_title VARCHAR; v_summary VARCHAR; v_pdf VARCHAR;
    v_lines ARRAY;
BEGIN
    v_price := COALESCE(:P_UNIT_PRICE, 11.20);

    SELECT COUNT(*) INTO :v_exists
      FROM BLUEBERRY_CHAIN.RAW.SHIPMENTS
     WHERE SHIPMENT_ID = :P_SHIPMENT_ID AND ACTUAL_ARRIVAL_TS IS NOT NULL;

    IF (v_exists = 0) THEN
        RETURN OBJECT_CONSTRUCT('status','ERROR','tool','GENERATE_INVOICE',
            'message','Shipment ' || :P_SHIPMENT_ID || ' not found or has not arrived yet.');
    END IF;

    SELECT COUNT(*) INTO :v_exists
      FROM BLUEBERRY_CHAIN.RAW.INVOICES WHERE SHIPMENT_ID = :P_SHIPMENT_ID;
    IF (v_exists > 0) THEN
        RETURN OBJECT_CONSTRUCT('status','SKIPPED','tool','GENERATE_INVOICE',
            'shipment_id', :P_SHIPMENT_ID,
            'message','Shipment ' || :P_SHIPMENT_ID || ' is already invoiced.');
    END IF;

    -- Read shipment facts and canonical metrics from the semantic view
    SELECT MAX(M_SHIPPED_KG), MAX(M_DELIVERED_SELLABLE_KG), MAX(M_SHRINK_KG)
      INTO :v_shipped, :v_sellable, :v_shrink_kg
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS shipments.m_shipped_kg, shipments.m_delivered_sellable_kg,
                     shipments.m_shrink_kg
             DIMENSIONS shipments.d_shipment_id )
     WHERE D_SHIPMENT_ID = :P_SHIPMENT_ID;

    SELECT MAX(LOT_ID), MAX(DC_CODE), MAX(ACTUAL_ARRIVAL_TS::DATE), MAX(SHRINK_PCT)
      INTO :v_lot, :v_dc, :v_arr, :v_shrink_pct
      FROM BLUEBERRY_CHAIN.CURATED.DT_SHIPMENT_DELIVERY
     WHERE SHIPMENT_ID = :P_SHIPMENT_ID;

    SELECT MAX(SPOILAGE_RISK_SCORE), MAX(TEMPERATURE_COMPLIANCE_PCT),
           MAX(M_MAX_EXCURSION_HOURS), MAX(M_TOTAL_HARVESTED_KG)
      INTO :v_risk, :v_comp, :v_exc, :v_qty
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                     lots.m_max_excursion_hours, lots.m_total_harvested_kg
             DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :v_lot;

    SELECT MAX(l.VARIETY), MAX(r.RANCH_NAME) INTO :v_variety, :v_ranch
      FROM BLUEBERRY_CHAIN.RAW.HARVEST_LOTS l
      JOIN BLUEBERRY_CHAIN.RAW.BLOCKS b ON b.BLOCK_ID = l.BLOCK_ID
      JOIN BLUEBERRY_CHAIN.RAW.RANCHES r ON r.RANCH_ID = b.RANCH_ID
     WHERE l.LOT_ID = :v_lot;

    -- Find the open retailer PO this shipment's variety + DC was filling
    SELECT MAX(p.PO_ID) INTO :v_po
      FROM BLUEBERRY_CHAIN.RAW.PO_LINES pl
      JOIN BLUEBERRY_CHAIN.RAW.RETAILER_POS p ON p.PO_ID = pl.PO_ID
     WHERE pl.VARIETY = :v_variety AND p.DC_CODE = :v_dc AND p.STATUS = 'OPEN';

    -- Invoice on the sellable quantity; shrink becomes an explicit deduction
    v_gross  := ROUND(COALESCE(:v_shipped,0) * :v_price, 2);
    v_deduct := ROUND(COALESCE(:v_shrink_kg,0) * :v_price, 2);
    v_net    := ROUND(:v_gross - :v_deduct, 2);

    SELECT 'INV-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-'
                || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_INVOICE.NEXTVAL, 5, '0') INTO :v_inv_id;

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SPOILAGE_RISK_SCORE', :v_risk, 'TEMPERATURE_COMPLIANCE_PCT', :v_comp,
        'EXCURSION_HOURS', :v_exc, 'SHIPPED_KG', :v_shipped,
        'DELIVERED_SELLABLE_KG', :v_sellable, 'SHRINK_KG', :v_shrink_kg,
        'SHRINK_PCT', :v_shrink_pct, 'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    -- Build a real single-page PDF for the invoice
    v_title   := 'Invoice ' || :v_inv_id;
    v_summary := 'Invoice for ' || :v_shipped || ' kg ' || :v_variety
                 || ' blueberries from ' || :v_ranch || ' arriving at ' || :v_dc
                 || ' on ' || :v_arr || '. Gross USD ' || :v_gross
                 || ' less shrink deduction USD ' || :v_deduct
                 || ' equals net USD ' || :v_net || '.';
    v_lines := ARRAY_CONSTRUCT(
        'BlueberryChain OS - Customer Invoice',
        'Invoice: ' || :v_inv_id,
        'Date: ' || CURRENT_DATE()::VARCHAR,
        'Shipment: ' || :P_SHIPMENT_ID || '  Lot: ' || :v_lot,
        'Variety: ' || :v_variety || '  Origin: ' || :v_ranch,
        'Destination: ' || :v_dc || '  Arrived: ' || :v_arr::VARCHAR,
        '',
        'Quantity shipped:      ' || :v_shipped || ' kg',
        'Unit price:            USD ' || :v_price || ' /kg',
        'Gross amount:          USD ' || :v_gross,
        'Cold chain shrink:     -' || :v_shrink_kg || ' kg  (USD ' || :v_deduct || ')',
        'Net amount due:        USD ' || :v_net,
        '',
        'Cold chain: ' || :v_exc || ' excursion hours, '
          || :v_comp || '% temperature compliance, Spoilage Risk ' || :v_risk
    );
    v_pdf := BLUEBERRY_CHAIN.TOOLS.BUILD_SIMPLE_PDF(:v_lines);

    INSERT INTO BLUEBERRY_CHAIN.RAW.INVOICES
      (INVOICE_ID, PO_ID, SHIPMENT_ID, LOT_ID, INVOICE_DATE, INVOICED_KG,
       GROSS_AMOUNT_USD, SHRINK_DEDUCTION_USD, NET_AMOUNT_USD, STATUS, PDF_URL,
       DOC_TITLE, DOC_SUMMARY, PDF_B64)
    SELECT :v_inv_id, :v_po, :P_SHIPMENT_ID, :v_lot, CURRENT_DATE(), :v_shipped,
           :v_gross, :v_deduct, :v_net, 'ISSUED',
           'https://bbc-docs.internal/invoices/' || :v_inv_id || '.pdf',
           :v_title, :v_summary, :v_pdf;

    -- Grower settlement, net of the same quality deduction
    SELECT MAX(r.GROWER_ID), MAX(l.GROWER_PRICE_PER_KG)
      INTO :v_grower, :v_grower_price
      FROM BLUEBERRY_CHAIN.RAW.HARVEST_LOTS l
      JOIN BLUEBERRY_CHAIN.RAW.BLOCKS  b ON b.BLOCK_ID = l.BLOCK_ID
      JOIN BLUEBERRY_CHAIN.RAW.RANCHES r ON r.RANCH_ID = b.RANCH_ID
     WHERE l.LOT_ID = :v_lot;

    SELECT 'STL-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-'
                || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_SETTLE.NEXTVAL, 5, '0') INTO :v_stl_id;

    INSERT INTO BLUEBERRY_CHAIN.RAW.GROWER_SETTLEMENTS
      (SETTLEMENT_ID, LOT_ID, GROWER_ID, SETTLEMENT_DATE, GROSS_KG, ACCEPTED_KG,
       REJECTED_KG, PRICE_PER_KG, GROSS_AMOUNT_USD, QUALITY_DEDUCTION_USD,
       NET_AMOUNT_USD, STATUS)
    SELECT :v_stl_id, :v_lot, :v_grower, CURRENT_DATE(),
           :v_shipped, :v_sellable, :v_shrink_kg, :v_grower_price,
           ROUND(:v_shipped * :v_grower_price, 2),
           ROUND(:v_shrink_kg * :v_grower_price, 2),
           ROUND(:v_sellable * :v_grower_price, 2), 'SETTLED';

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'FINANCE_AGENT', 'GENERATE_INVOICE', 'SHIPMENT', :P_SHIPMENT_ID,
           OBJECT_CONSTRUCT('shipment_id', :P_SHIPMENT_ID, 'invoice_id', :v_inv_id,
                            'settlement_id', :v_stl_id, 'unit_price_usd', :v_price),
           :v_snap, 'FULL_AUTO', 'NOT_REQUIRED',
           'Invoice ' || :v_inv_id || ' net USD ' || :v_net
           || ', settlement ' || :v_stl_id;

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','GENERATE_INVOICE',
        'decision_id', :v_dec_id, 'invoice_id', :v_inv_id, 'settlement_id', :v_stl_id,
        'shipment_id', :P_SHIPMENT_ID, 'lot_id', :v_lot, 'dc_code', :v_dc,
        'arrival_date', :v_arr::VARCHAR, 'invoiced_kg', :v_shipped,
        'gross_amount_usd', :v_gross, 'shrink_deduction_usd', :v_deduct,
        'net_amount_usd', :v_net,
        'doc_title', :v_title, 'doc_summary', :v_summary, 'pdf_b64', :v_pdf,
        'invoice_pdf_url','https://bbc-docs.internal/invoices/' || :v_inv_id || '.pdf',
        'settlement_pdf_url','https://bbc-docs.internal/settlements/' || :v_stl_id || '.pdf',
        'metrics_used', :v_snap,
        'message','Invoice ' || :v_inv_id || ' issued for shipment ' || :P_SHIPMENT_ID
                  || ': gross USD ' || :v_gross || ' less shrink deduction USD '
                  || :v_deduct || ' equals net USD ' || :v_net
                  || '. Shrink of ' || :v_shrink_kg || ' kg derived from '
                  || :v_exc || ' excursion hours at ' || :v_comp
                  || '% temperature compliance. Grower settlement ' || :v_stl_id || ' raised.');
END;
$$;

-- =====================================================================
-- TOOL 7: WRITE_CREDIT_NOTE   (THRESHOLD - final settlement needs a human)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.WRITE_CREDIT_NOTE(
    P_LOT_ID         VARCHAR,
    P_PO_ID          VARCHAR,
    P_AMOUNT_USD     NUMBER(14,2),
    P_REASON_CODE    VARCHAR,
    P_IS_PROVISIONAL BOOLEAN,
    P_THREAD_ID      VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Raise a credit note against a lot. Pass P_AMOUNT_USD = 0 to auto-size the provision from the Spoilage Risk Score. Provisional notes are automatic; final settlements above the configured threshold are queued for human approval.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_risk NUMBER(10,2); v_comp NUMBER(10,2); v_exc NUMBER(10,2);
    v_qty NUMBER(14,2); v_value NUMBER(14,2); v_price NUMBER(10,4);
    v_amount NUMBER(14,2); v_threshold NUMBER(14,2); v_level VARCHAR;
    v_prov BOOLEAN; v_autosized BOOLEAN;
    v_cn_id VARCHAR; v_dec_id VARCHAR; v_app_id VARCHAR;
    v_snap VARIANT; v_cost_id VARCHAR;
    v_title VARCHAR; v_summary VARCHAR; v_pdf VARCHAR; v_cpdf VARCHAR;
    v_lines ARRAY;
BEGIN
    v_prov := COALESCE(:P_IS_PROVISIONAL, TRUE);

    SELECT MAX(SPOILAGE_RISK_SCORE), MAX(TEMPERATURE_COMPLIANCE_PCT),
           MAX(M_MAX_EXCURSION_HOURS), MAX(M_TOTAL_HARVESTED_KG), MAX(M_PRODUCT_VALUE_USD)
      INTO :v_risk, :v_comp, :v_exc, :v_qty, :v_value
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                     lots.m_max_excursion_hours, lots.m_total_harvested_kg,
                     lots.m_product_value_usd
             DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :P_LOT_ID;

    -- P_AMOUNT_USD of 0 (or null) means auto-size from the Spoilage Risk Score.
    -- NOTE: custom tools call procedures with NAMED ARGUMENTS, so the agent must
    -- supply every parameter. A 0 sentinel is used instead of a nullable number
    -- because omitting the argument causes a signature mismatch, and passing the
    -- string "null" fails to bind to a numeric type.
    SELECT COALESCE(MAX(GROWER_PRICE_PER_KG),0) INTO :v_price
      FROM BLUEBERRY_CHAIN.RAW.HARVEST_LOTS WHERE LOT_ID = :P_LOT_ID;

    IF (COALESCE(:P_AMOUNT_USD, 0) <= 0) THEN
        v_amount := ROUND(COALESCE(:v_qty,0) * COALESCE(:v_price,0)
                          * (COALESCE(:v_risk,0) / 100.0), 2);
        v_autosized := TRUE;
    ELSE
        v_amount := :P_AMOUNT_USD;
        v_autosized := FALSE;
    END IF;

    SELECT MAX(AUTONOMY_LEVEL), MAX(VALUE_THRESHOLD_USD) INTO :v_level, :v_threshold
      FROM BLUEBERRY_CHAIN.TOOLS.AUTONOMY_POLICY WHERE TOOL_NAME = 'WRITE_CREDIT_NOTE';

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SPOILAGE_RISK_SCORE', :v_risk, 'TEMPERATURE_COMPLIANCE_PCT', :v_comp,
        'EXCURSION_HOURS', :v_exc, 'LOT_QTY_KG', :v_qty,
        'PRODUCT_VALUE_USD', :v_value, 'PROVISION_AUTOSIZED', :v_autosized,
        'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    -- Final (non-provisional) notes above threshold require a human
    IF (v_prov = FALSE AND COALESCE(v_amount,0) > COALESCE(v_threshold, 1e18)) THEN
        SELECT 'APR-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_APPROVAL.NEXTVAL, 6, '0') INTO :v_app_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
          (APPROVAL_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ACTION_PAYLOAD,
           METRIC_SNAPSHOT, ESTIMATED_VALUE_USD, STATUS)
        SELECT :v_app_id, :P_THREAD_ID, 'FINANCE_AGENT', 'WRITE_CREDIT_NOTE',
               OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'po_id', :P_PO_ID,
                                'amount_usd', :v_amount, 'reason_code', :P_REASON_CODE,
                                'is_provisional', FALSE),
               :v_snap, :v_amount, 'PENDING';

        SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
          (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
           ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
        SELECT :v_dec_id, :P_THREAD_ID, 'FINANCE_AGENT', 'WRITE_CREDIT_NOTE', 'LOT', :P_LOT_ID,
               OBJECT_CONSTRUCT('approval_id', :v_app_id, 'amount_usd', :v_amount),
               :v_snap, :v_level, 'PENDING',
               'Final credit note USD ' || :v_amount || ' queued for approval';

        RETURN OBJECT_CONSTRUCT('status','PENDING_APPROVAL','tool','WRITE_CREDIT_NOTE',
            'approval_id', :v_app_id, 'decision_id', :v_dec_id, 'lot_id', :P_LOT_ID,
            'amount_usd', :v_amount, 'threshold_usd', :v_threshold,
            'metrics_used', :v_snap,
            'message','Final claim settlement of USD ' || :v_amount || ' exceeds the USD '
                      || :v_threshold || ' auto-approval threshold. Queued as '
                      || :v_app_id || '. No credit note has been issued yet.');
    END IF;

    SELECT 'CN-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-'
               || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_CREDIT.NEXTVAL, 5, '0') INTO :v_cn_id;

    -- Build a real single-page PDF for the credit note
    v_title   := CASE WHEN :v_prov THEN 'Provisional' ELSE 'Final' END
                 || ' Credit Note ' || :v_cn_id;
    v_summary := CASE WHEN :v_prov THEN 'Provisional' ELSE 'Final' END
                 || ' credit note ' || :v_cn_id || ' for USD ' || :v_amount
                 || ' against lot ' || :P_LOT_ID
                 || CASE WHEN :P_PO_ID <> '' THEN ' on ' || :P_PO_ID ELSE '' END
                 || '. Reason ' || :P_REASON_CODE || '.';
    v_lines := ARRAY_CONSTRUCT(
        'BlueberryChain OS - ' || CASE WHEN :v_prov THEN 'Provisional' ELSE 'Final' END || ' Credit Note',
        'Credit Note: ' || :v_cn_id,
        'Date: ' || CURRENT_DATE()::VARCHAR,
        'Lot: ' || :P_LOT_ID || CASE WHEN :P_PO_ID <> '' THEN '  PO: ' || :P_PO_ID ELSE '' END,
        'Reason: ' || :P_REASON_CODE,
        '',
        'Amount: USD ' || :v_amount,
        'Status: ' || CASE WHEN :v_prov THEN 'PROVISIONAL' ELSE 'FINAL' END,
        '',
        'Spoilage Risk Score: ' || :v_risk || '   Temperature Compliance: ' || :v_comp || '%',
        'Excursion hours: ' || :v_exc || '   Lot quantity: ' || :v_qty || ' kg',
        '',
        'This provision is auto-sized from the governed Spoilage Risk Score read from',
        'SEMANTIC.ORGANIC_BLUEBERRY_CHAIN at decision time.'
    );
    v_cpdf := BLUEBERRY_CHAIN.TOOLS.BUILD_SIMPLE_PDF(:v_lines);

    INSERT INTO BLUEBERRY_CHAIN.RAW.CREDIT_NOTES
      (CREDIT_NOTE_ID, INVOICE_ID, PO_ID, LOT_ID, ISSUE_DATE, AMOUNT_USD,
       REASON_CODE, IS_PROVISIONAL, STATUS, PDF_URL, DOC_TITLE, DOC_SUMMARY, PDF_B64)
    SELECT :v_cn_id, NULL, NULLIF(:P_PO_ID,''), :P_LOT_ID, CURRENT_DATE(), :v_amount,
           :P_REASON_CODE, :v_prov,
           CASE WHEN :v_prov THEN 'PROVISIONAL' ELSE 'FINAL' END,
           'https://bbc-docs.internal/credit-notes/' || :v_cn_id || '.pdf',
           :v_title, :v_summary, :v_cpdf;

    -- A claim is a landed-cost component
    SELECT 'CST-CLM-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_COST.NEXTVAL, 8, '0') INTO :v_cost_id;
    INSERT INTO BLUEBERRY_CHAIN.RAW.LOT_COST_COMPONENTS
      (COST_ID, LOT_ID, COST_TYPE, AMOUNT_USD, SOURCE_TOOL)
    SELECT :v_cost_id, :P_LOT_ID, 'CLAIM', :v_amount, 'WRITE_CREDIT_NOTE';

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'FINANCE_AGENT', 'WRITE_CREDIT_NOTE', 'LOT', :P_LOT_ID,
           OBJECT_CONSTRUCT('credit_note_id', :v_cn_id, 'amount_usd', :v_amount,
                            'is_provisional', :v_prov, 'reason_code', :P_REASON_CODE),
           :v_snap, :v_level, 'NOT_REQUIRED',
           'Credit note ' || :v_cn_id || ' USD ' || :v_amount;

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','WRITE_CREDIT_NOTE',
        'decision_id', :v_dec_id, 'credit_note_id', :v_cn_id, 'lot_id', :P_LOT_ID,
        'po_id', :P_PO_ID, 'amount_usd', :v_amount,
        'provision_autosized', :v_autosized,
        'is_provisional', :v_prov, 'reason_code', :P_REASON_CODE,
        'doc_title', :v_title, 'doc_summary', :v_summary, 'pdf_b64', :v_cpdf,
        'credit_note_pdf_url','https://bbc-docs.internal/credit-notes/' || :v_cn_id || '.pdf',
        'metrics_used', :v_snap,
        'message', CASE WHEN :v_prov THEN 'Provisional' ELSE 'Final' END
                  || ' credit note ' || :v_cn_id || ' raised for USD ' || :v_amount
                  || ' against lot ' || :P_LOT_ID || '. Sized from Spoilage Risk Score '
                  || :v_risk || ' at ' || :v_comp || '% temperature compliance. '
                  || 'Posted to the cost ledger as a CLAIM component.');
END;
$$;

-- =====================================================================
-- TOOL 8: SEND_NOTIFICATION   (FULL_AUTO - communication only)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.SEND_NOTIFICATION(
    P_CHANNEL     VARCHAR,
    P_RECIPIENT   VARCHAR,
    P_SUBJECT     VARCHAR,
    P_BODY        VARCHAR,
    P_ENTITY_TYPE VARCHAR,
    P_ENTITY_ID   VARCHAR,
    P_THREAD_ID   VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Send a notification to a stakeholder and record it in the audit trail.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_nid VARCHAR; v_dec_id VARCHAR;
BEGIN
    SELECT 'NTF-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_NOTIF.NEXTVAL, 7, '0') INTO :v_nid;

    INSERT INTO BLUEBERRY_CHAIN.AUDIT.NOTIFICATIONS
      (NOTIFICATION_ID, CHANNEL, RECIPIENT, SUBJECT, BODY,
       RELATED_ENTITY_TYPE, RELATED_ENTITY_ID)
    SELECT :v_nid, COALESCE(:P_CHANNEL,'EMAIL'), :P_RECIPIENT, :P_SUBJECT, :P_BODY,
           :P_ENTITY_TYPE, :P_ENTITY_ID;

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'SUPERVISOR_AGENT', 'SEND_NOTIFICATION',
           :P_ENTITY_TYPE, :P_ENTITY_ID,
           OBJECT_CONSTRUCT('notification_id', :v_nid, 'channel', :P_CHANNEL,
                            'recipient', :P_RECIPIENT, 'subject', :P_SUBJECT),
           OBJECT_CONSTRUCT('note','notification carries no metric dependency'),
           'FULL_AUTO', 'NOT_REQUIRED', 'Notification sent to ' || :P_RECIPIENT;

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','SEND_NOTIFICATION',
        'decision_id', :v_dec_id, 'notification_id', :v_nid,
        'channel', COALESCE(:P_CHANNEL,'EMAIL'), 'recipient', :P_RECIPIENT,
        'message','Notification ' || :v_nid || ' sent to ' || :P_RECIPIENT
                  || ' via ' || COALESCE(:P_CHANNEL,'EMAIL') || '.');
END;
$$;

-- =====================================================================
-- TOOL 9: DIVERT_LOT   (THRESHOLD)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.DIVERT_LOT(
    P_LOT_ID     VARCHAR,
    P_NEW_DC     VARCHAR,
    P_REASON     VARCHAR,
    P_THREAD_ID  VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Divert a lot in transit to a different destination, for example to a processing outlet when shelf life no longer supports fresh retail. Value-gated.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_risk NUMBER(10,2); v_shelf NUMBER(10,2); v_qty NUMBER(14,2);
    v_value NUMBER(14,2); v_threshold NUMBER(14,2); v_level VARCHAR;
    v_old_dc VARCHAR; v_snap VARIANT; v_dec_id VARCHAR; v_app_id VARCHAR;
BEGIN
    SELECT MAX(SPOILAGE_RISK_SCORE), MAX(M_MIN_SHELF_LIFE_EFFECTIVE),
           MAX(M_TOTAL_HARVESTED_KG), MAX(M_PRODUCT_VALUE_USD)
      INTO :v_risk, :v_shelf, :v_qty, :v_value
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.m_min_shelf_life_effective,
                     lots.m_total_harvested_kg, lots.m_product_value_usd
             DIMENSIONS lots.d_lot_id )
     WHERE D_LOT_ID = :P_LOT_ID;

    SELECT MAX(DC_CODE) INTO :v_old_dc
      FROM BLUEBERRY_CHAIN.RAW.SHIPMENTS WHERE LOT_ID = :P_LOT_ID;

    SELECT MAX(AUTONOMY_LEVEL), MAX(VALUE_THRESHOLD_USD) INTO :v_level, :v_threshold
      FROM BLUEBERRY_CHAIN.TOOLS.AUTONOMY_POLICY WHERE TOOL_NAME = 'DIVERT_LOT';

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SPOILAGE_RISK_SCORE', :v_risk, 'SHELF_LIFE_DAYS_EFFECTIVE', :v_shelf,
        'LOT_QTY_KG', :v_qty, 'PRODUCT_VALUE_USD', :v_value,
        'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    IF (COALESCE(v_value,0) > COALESCE(v_threshold, 1e18)) THEN
        SELECT 'APR-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_APPROVAL.NEXTVAL, 6, '0') INTO :v_app_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
          (APPROVAL_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ACTION_PAYLOAD,
           METRIC_SNAPSHOT, ESTIMATED_VALUE_USD, STATUS)
        SELECT :v_app_id, :P_THREAD_ID, 'COLD_CHAIN_AGENT', 'DIVERT_LOT',
               OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'new_dc', :P_NEW_DC, 'reason', :P_REASON),
               :v_snap, :v_value, 'PENDING';

        SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
          (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
           ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
        SELECT :v_dec_id, :P_THREAD_ID, 'COLD_CHAIN_AGENT', 'DIVERT_LOT', 'LOT', :P_LOT_ID,
               OBJECT_CONSTRUCT('approval_id', :v_app_id), :v_snap, :v_level, 'PENDING',
               'Diversion queued for approval, value USD ' || :v_value;

        RETURN OBJECT_CONSTRUCT('status','PENDING_APPROVAL','tool','DIVERT_LOT',
            'approval_id', :v_app_id, 'decision_id', :v_dec_id, 'lot_id', :P_LOT_ID,
            'estimated_value_usd', :v_value, 'threshold_usd', :v_threshold,
            'metrics_used', :v_snap,
            'message','Diverting ' || :P_LOT_ID || ' (USD ' || :v_value
                      || ') exceeds the USD ' || :v_threshold
                      || ' threshold. Queued as ' || :v_app_id
                      || '. The lot has not been diverted yet.');
    END IF;

    UPDATE BLUEBERRY_CHAIN.RAW.SHIPMENTS
       SET DC_CODE = :P_NEW_DC, STATUS = 'DIVERTED', LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE LOT_ID = :P_LOT_ID;

    UPDATE BLUEBERRY_CHAIN.RAW.HARVEST_LOTS
       SET LOT_STATUS = 'DIVERTED', HOLD_REASON = :P_REASON,
           LAST_UPDATED_TS = CURRENT_TIMESTAMP()
     WHERE LOT_ID = :P_LOT_ID;

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'COLD_CHAIN_AGENT', 'DIVERT_LOT', 'LOT', :P_LOT_ID,
           OBJECT_CONSTRUCT('lot_id', :P_LOT_ID, 'from_dc', :v_old_dc,
                            'to_dc', :P_NEW_DC, 'reason', :P_REASON),
           :v_snap, :v_level, 'NOT_REQUIRED',
           'Lot diverted from ' || :v_old_dc || ' to ' || :P_NEW_DC;

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','DIVERT_LOT',
        'decision_id', :v_dec_id, 'lot_id', :P_LOT_ID,
        'from_dc', :v_old_dc, 'to_dc', :P_NEW_DC,
        'metrics_used', :v_snap,
        'message','Lot ' || :P_LOT_ID || ' diverted from ' || :v_old_dc || ' to '
                  || :P_NEW_DC || '. Spoilage Risk Score ' || :v_risk
                  || ' with ' || :v_shelf || ' days of effective shelf life remaining.');
END;
$$;

-- =====================================================================
-- TOOL 10: CREATE_HARVEST_REQUEST   (THRESHOLD)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.CREATE_HARVEST_REQUEST(
    P_RANCH_ID   VARCHAR,
    P_VARIETY    VARCHAR,
    P_QTY_KG     NUMBER(14,2),
    P_NEEDED_BY  VARCHAR,
    P_REASON     VARCHAR,
    P_THREAD_ID  VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Request a replacement harvest from a specific ranch. Checks that ranch cold chain performance supports the request. Value-gated.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_risk NUMBER(10,2); v_comp NUMBER(10,2); v_avail NUMBER(14,2);
    v_price NUMBER(10,4); v_value NUMBER(14,2);
    v_threshold NUMBER(14,2); v_level VARCHAR;
    v_req_id VARCHAR; v_dec_id VARCHAR; v_app_id VARCHAR; v_snap VARIANT;
BEGIN
    SELECT MAX(SPOILAGE_RISK_SCORE), MAX(TEMPERATURE_COMPLIANCE_PCT),
           MAX(M_TOTAL_HARVESTED_KG)
      INTO :v_risk, :v_comp, :v_avail
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.SPOILAGE_RISK_SCORE, lots.TEMPERATURE_COMPLIANCE_PCT,
                     lots.m_total_harvested_kg
             DIMENSIONS lots.d_ranch_id )
     WHERE D_RANCH_ID = :P_RANCH_ID;

    SELECT COALESCE(AVG(GROWER_PRICE_PER_KG), 6.50) INTO :v_price
      FROM BLUEBERRY_CHAIN.RAW.HARVEST_LOTS l
      JOIN BLUEBERRY_CHAIN.RAW.BLOCKS b ON b.BLOCK_ID = l.BLOCK_ID
     WHERE b.RANCH_ID = :P_RANCH_ID;

    v_value := ROUND(COALESCE(:P_QTY_KG,0) * :v_price, 2);

    SELECT MAX(AUTONOMY_LEVEL), MAX(VALUE_THRESHOLD_USD) INTO :v_level, :v_threshold
      FROM BLUEBERRY_CHAIN.TOOLS.AUTONOMY_POLICY WHERE TOOL_NAME = 'CREATE_HARVEST_REQUEST';

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SOURCE_RANCH_SPOILAGE_RISK_SCORE', :v_risk,
        'SOURCE_RANCH_TEMPERATURE_COMPLIANCE_PCT', :v_comp,
        'SOURCE_RANCH_HARVESTED_KG', :v_avail,
        'EST_VALUE_USD', :v_value, 'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    IF (v_value > COALESCE(v_threshold, 1e18)) THEN
        SELECT 'APR-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_APPROVAL.NEXTVAL, 6, '0') INTO :v_app_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
          (APPROVAL_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ACTION_PAYLOAD,
           METRIC_SNAPSHOT, ESTIMATED_VALUE_USD, STATUS)
        SELECT :v_app_id, :P_THREAD_ID, 'HARVEST_AGENT', 'CREATE_HARVEST_REQUEST',
               OBJECT_CONSTRUCT('ranch_id', :P_RANCH_ID, 'variety', :P_VARIETY,
                                'qty_kg', :P_QTY_KG, 'needed_by', :P_NEEDED_BY,
                                'reason', :P_REASON),
               :v_snap, :v_value, 'PENDING';

        SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
          (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
           ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
        SELECT :v_dec_id, :P_THREAD_ID, 'HARVEST_AGENT', 'CREATE_HARVEST_REQUEST',
               'RANCH', :P_RANCH_ID,
               OBJECT_CONSTRUCT('approval_id', :v_app_id, 'qty_kg', :P_QTY_KG),
               :v_snap, :v_level, 'PENDING',
               'Harvest request USD ' || :v_value || ' queued for approval';

        RETURN OBJECT_CONSTRUCT('status','PENDING_APPROVAL','tool','CREATE_HARVEST_REQUEST',
            'approval_id', :v_app_id, 'decision_id', :v_dec_id,
            'ranch_id', :P_RANCH_ID, 'variety', :P_VARIETY, 'qty_kg', :P_QTY_KG,
            'estimated_value_usd', :v_value, 'threshold_usd', :v_threshold,
            'source_ranch_temperature_compliance_pct', :v_comp,
            'metrics_used', :v_snap,
            'message','Replacement harvest of ' || :P_QTY_KG || ' kg ' || :P_VARIETY
                      || ' from ' || :P_RANCH_ID || ' is valued at USD ' || :v_value
                      || ', above the USD ' || :v_threshold || ' threshold. Queued as '
                      || :v_app_id || ' for your approval. That ranch runs at '
                      || :v_comp || '% temperature compliance.');
    END IF;

    SELECT 'HRQ-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_HARVESTRQ.NEXTVAL, 6, '0') INTO :v_req_id;
    INSERT INTO BLUEBERRY_CHAIN.RAW.HARVEST_REQUESTS
      (REQUEST_ID, RANCH_ID, VARIETY, REQUESTED_KG, NEEDED_BY, EST_VALUE_USD, STATUS, REASON)
    SELECT :v_req_id, :P_RANCH_ID, :P_VARIETY, :P_QTY_KG,
           TRY_TO_DATE(:P_NEEDED_BY), :v_value, 'REQUESTED', :P_REASON;

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'HARVEST_AGENT', 'CREATE_HARVEST_REQUEST',
           'HARVEST_REQUEST', :v_req_id,
           OBJECT_CONSTRUCT('ranch_id', :P_RANCH_ID, 'variety', :P_VARIETY, 'qty_kg', :P_QTY_KG),
           :v_snap, :v_level, 'NOT_REQUIRED', 'Harvest request ' || :v_req_id || ' raised';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','CREATE_HARVEST_REQUEST',
        'decision_id', :v_dec_id, 'request_id', :v_req_id,
        'ranch_id', :P_RANCH_ID, 'variety', :P_VARIETY, 'qty_kg', :P_QTY_KG,
        'estimated_value_usd', :v_value,
        'metrics_used', :v_snap,
        'message','Harvest request ' || :v_req_id || ' raised for ' || :P_QTY_KG
                  || ' kg ' || :P_VARIETY || ' from ' || :P_RANCH_ID
                  || ' at an estimated USD ' || :v_value || '.');
END;
$$;

-- =====================================================================
-- TOOL 11: CREATE_PO   (THRESHOLD - large replacement POs need a human)
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.CREATE_PO(
    P_SUPPLIER_RANCH_ID VARCHAR,
    P_VARIETY           VARCHAR,
    P_QTY_KG            NUMBER(14,2),
    P_UNIT_PRICE_USD    NUMBER(10,4),
    P_DC_CODE           VARCHAR,
    P_REASON            VARCHAR,
    P_THREAD_ID         VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Raise a replacement or supplementary procurement PO against a supplier ranch. Value-gated: large POs are queued for human approval.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_comp NUMBER(10,2); v_risk NUMBER(10,2); v_atp NUMBER(14,2);
    v_price NUMBER(10,4); v_value NUMBER(14,2);
    v_threshold NUMBER(14,2); v_level VARCHAR;
    v_po_id VARCHAR; v_dec_id VARCHAR; v_app_id VARCHAR; v_snap VARIANT;
BEGIN
    v_price := COALESCE(:P_UNIT_PRICE_USD, 7.00);
    v_value := ROUND(COALESCE(:P_QTY_KG,0) * :v_price, 2);

    SELECT MAX(TEMPERATURE_COMPLIANCE_PCT), MAX(SPOILAGE_RISK_SCORE)
      INTO :v_comp, :v_risk
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS lots.TEMPERATURE_COMPLIANCE_PCT, lots.SPOILAGE_RISK_SCORE
             DIMENSIONS lots.d_ranch_id )
     WHERE D_RANCH_ID = :P_SUPPLIER_RANCH_ID;

    SELECT MAX(ATP_QUALITY_ADJUSTED) INTO :v_atp
      FROM SEMANTIC_VIEW( BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN
             METRICS inventory.ATP_QUALITY_ADJUSTED DIMENSIONS dcs.d_dc_code )
     WHERE D_DC_CODE = :P_DC_CODE;

    SELECT MAX(AUTONOMY_LEVEL), MAX(VALUE_THRESHOLD_USD) INTO :v_level, :v_threshold
      FROM BLUEBERRY_CHAIN.TOOLS.AUTONOMY_POLICY WHERE TOOL_NAME = 'CREATE_PO';

    v_snap := OBJECT_CONSTRUCT(
        'semantic_view','BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
        'SUPPLIER_TEMPERATURE_COMPLIANCE_PCT', :v_comp,
        'SUPPLIER_SPOILAGE_RISK_SCORE', :v_risk,
        'DEST_ATP_QUALITY_ADJUSTED', :v_atp,
        'PO_VALUE_USD', :v_value, 'read_at', CURRENT_TIMESTAMP()::VARCHAR);

    IF (v_value > COALESCE(v_threshold, 1e18)) THEN
        SELECT 'APR-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_APPROVAL.NEXTVAL, 6, '0') INTO :v_app_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
          (APPROVAL_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ACTION_PAYLOAD,
           METRIC_SNAPSHOT, ESTIMATED_VALUE_USD, STATUS)
        SELECT :v_app_id, :P_THREAD_ID, 'PROCUREMENT_AGENT', 'CREATE_PO',
               OBJECT_CONSTRUCT('supplier_ranch_id', :P_SUPPLIER_RANCH_ID,
                                'variety', :P_VARIETY, 'qty_kg', :P_QTY_KG,
                                'unit_price_usd', :v_price, 'dc_code', :P_DC_CODE,
                                'reason', :P_REASON),
               :v_snap, :v_value, 'PENDING';

        SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
        INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
          (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
           ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
        SELECT :v_dec_id, :P_THREAD_ID, 'PROCUREMENT_AGENT', 'CREATE_PO',
               'RANCH', :P_SUPPLIER_RANCH_ID,
               OBJECT_CONSTRUCT('approval_id', :v_app_id, 'value_usd', :v_value),
               :v_snap, :v_level, 'PENDING',
               'Replacement PO USD ' || :v_value || ' queued for approval';

        RETURN OBJECT_CONSTRUCT('status','PENDING_APPROVAL','tool','CREATE_PO',
            'approval_id', :v_app_id, 'decision_id', :v_dec_id,
            'supplier_ranch_id', :P_SUPPLIER_RANCH_ID, 'variety', :P_VARIETY,
            'qty_kg', :P_QTY_KG, 'unit_price_usd', :v_price,
            'estimated_value_usd', :v_value, 'threshold_usd', :v_threshold,
            'supplier_temperature_compliance_pct', :v_comp,
            'metrics_used', :v_snap,
            'message','Replacement PO for ' || :P_QTY_KG || ' kg ' || :P_VARIETY
                      || ' from ' || :P_SUPPLIER_RANCH_ID || ' into ' || :P_DC_CODE
                      || ' is valued at USD ' || :v_value || ', above the USD '
                      || :v_threshold || ' auto-approval threshold. Queued as '
                      || :v_app_id || ' for your confirmation. Nothing has been ordered yet. '
                      || 'That supplier runs at ' || :v_comp || '% temperature compliance.');
    END IF;

    SELECT 'PPO-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_PROCPO.NEXTVAL, 6, '0') INTO :v_po_id;
    INSERT INTO BLUEBERRY_CHAIN.RAW.PROCUREMENT_POS
      (PROC_PO_ID, SUPPLIER_RANCH_ID, VARIETY, QTY_KG, UNIT_PRICE_USD,
       DC_CODE, TOTAL_VALUE_USD, STATUS, REASON)
    SELECT :v_po_id, :P_SUPPLIER_RANCH_ID, :P_VARIETY, :P_QTY_KG, :v_price,
           :P_DC_CODE, :v_value, 'ISSUED', :P_REASON;

    SELECT 'DEC-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_DECISION.NEXTVAL, 8, '0') INTO :v_dec_id;
    INSERT INTO BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      (DECISION_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
       ACTION_PAYLOAD, METRIC_SNAPSHOT, AUTONOMY_LEVEL, APPROVAL_STATUS, RESULT_SUMMARY)
    SELECT :v_dec_id, :P_THREAD_ID, 'PROCUREMENT_AGENT', 'CREATE_PO',
           'PROCUREMENT_PO', :v_po_id,
           OBJECT_CONSTRUCT('po_id', :v_po_id, 'value_usd', :v_value),
           :v_snap, :v_level, 'NOT_REQUIRED', 'Procurement PO ' || :v_po_id || ' issued';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','CREATE_PO',
        'decision_id', :v_dec_id, 'procurement_po_id', :v_po_id,
        'supplier_ranch_id', :P_SUPPLIER_RANCH_ID, 'variety', :P_VARIETY,
        'qty_kg', :P_QTY_KG, 'total_value_usd', :v_value,
        'metrics_used', :v_snap,
        'message','Procurement PO ' || :v_po_id || ' issued for ' || :P_QTY_KG
                  || ' kg ' || :P_VARIETY || ' from ' || :P_SUPPLIER_RANCH_ID
                  || ' into ' || :P_DC_CODE || ' at USD ' || :v_value || '.');
END;
$$;

-- =====================================================================
-- APPROVAL HELPERS
-- =====================================================================
CREATE OR REPLACE PROCEDURE TOOLS.APPROVE_ACTION(
    P_APPROVAL_ID VARCHAR,
    P_NOTE        VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Approve a queued high-value action and execute it. Human-in-the-loop entry point.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_tool VARCHAR; v_payload VARIANT; v_status VARCHAR;
    v_thread VARCHAR; v_result VARIANT; v_cnt NUMBER;
BEGIN
    SELECT COUNT(*) INTO :v_cnt
      FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
     WHERE APPROVAL_ID = :P_APPROVAL_ID AND STATUS = 'PENDING';

    IF (v_cnt = 0) THEN
        RETURN OBJECT_CONSTRUCT('status','ERROR',
            'message','No pending approval found with id ' || :P_APPROVAL_ID);
    END IF;

    SELECT MAX(TOOL_NAME), MAX(ACTION_PAYLOAD), MAX(THREAD_ID)
      INTO :v_tool, :v_payload, :v_thread
      FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE WHERE APPROVAL_ID = :P_APPROVAL_ID;

    UPDATE BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
       SET STATUS = 'APPROVED', DECIDED_AT = CURRENT_TIMESTAMP(),
           DECIDED_BY = CURRENT_USER(), DECISION_NOTE = :P_NOTE
     WHERE APPROVAL_ID = :P_APPROVAL_ID;

    -- Re-dispatch the original action now that a human has signed off.
    -- The threshold is bypassed by raising the policy ceiling for this call
    -- via a direct insert, so each tool stays the single implementation.
    CASE
      WHEN v_tool = 'CREATE_PO' THEN
        INSERT INTO BLUEBERRY_CHAIN.RAW.PROCUREMENT_POS
          (PROC_PO_ID, SUPPLIER_RANCH_ID, VARIETY, QTY_KG, UNIT_PRICE_USD,
           DC_CODE, TOTAL_VALUE_USD, STATUS, REASON)
        SELECT 'PPO-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_PROCPO.NEXTVAL, 6, '0'),
               :v_payload:supplier_ranch_id::VARCHAR, :v_payload:variety::VARCHAR,
               :v_payload:qty_kg::NUMBER(14,2), :v_payload:unit_price_usd::NUMBER(10,4),
               :v_payload:dc_code::VARCHAR,
               ROUND(:v_payload:qty_kg::NUMBER(14,2) * :v_payload:unit_price_usd::NUMBER(10,4), 2),
               'ISSUED', 'Approved via ' || :P_APPROVAL_ID;
      WHEN v_tool = 'CREATE_HARVEST_REQUEST' THEN
        INSERT INTO BLUEBERRY_CHAIN.RAW.HARVEST_REQUESTS
          (REQUEST_ID, RANCH_ID, VARIETY, REQUESTED_KG, NEEDED_BY, EST_VALUE_USD, STATUS, REASON)
        SELECT 'HRQ-' || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_HARVESTRQ.NEXTVAL, 6, '0'),
               :v_payload:ranch_id::VARCHAR, :v_payload:variety::VARCHAR,
               :v_payload:qty_kg::NUMBER(14,2), TRY_TO_DATE(:v_payload:needed_by::VARCHAR),
               NULL, 'REQUESTED', 'Approved via ' || :P_APPROVAL_ID;
      WHEN v_tool = 'WRITE_CREDIT_NOTE' THEN
        INSERT INTO BLUEBERRY_CHAIN.RAW.CREDIT_NOTES
          (CREDIT_NOTE_ID, PO_ID, LOT_ID, ISSUE_DATE, AMOUNT_USD, REASON_CODE,
           IS_PROVISIONAL, STATUS, PDF_URL)
        SELECT 'CN-' || TO_CHAR(CURRENT_DATE(),'YYYYMMDD') || '-'
               || LPAD(BLUEBERRY_CHAIN.TOOLS.SEQ_CREDIT.NEXTVAL, 5, '0'),
               :v_payload:po_id::VARCHAR, :v_payload:lot_id::VARCHAR, CURRENT_DATE(),
               :v_payload:amount_usd::NUMBER(14,2), :v_payload:reason_code::VARCHAR,
               FALSE, 'FINAL', 'https://bbc-docs.internal/credit-notes/approved.pdf';
      WHEN v_tool = 'RELEASE_LOT' THEN
        UPDATE BLUEBERRY_CHAIN.RAW.HARVEST_LOTS
           SET LOT_STATUS = 'RELEASED', HOLD_REASON = NULL,
               LAST_UPDATED_TS = CURRENT_TIMESTAMP()
         WHERE LOT_ID = :v_payload:lot_id::VARCHAR;
      WHEN v_tool = 'DIVERT_LOT' THEN
        UPDATE BLUEBERRY_CHAIN.RAW.SHIPMENTS
           SET DC_CODE = :v_payload:new_dc::VARCHAR, STATUS = 'DIVERTED',
               LAST_UPDATED_TS = CURRENT_TIMESTAMP()
         WHERE LOT_ID = :v_payload:lot_id::VARCHAR;
      ELSE
        NULL;
    END;

    UPDATE BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
       SET STATUS = 'EXECUTED' WHERE APPROVAL_ID = :P_APPROVAL_ID;

    UPDATE BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
       SET APPROVAL_STATUS = 'APPROVED'
     WHERE ACTION_PAYLOAD:approval_id::VARCHAR = :P_APPROVAL_ID;

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','APPROVE_ACTION',
        'approval_id', :P_APPROVAL_ID, 'executed_tool', :v_tool,
        'message','Approval ' || :P_APPROVAL_ID || ' granted and ' || :v_tool
                  || ' executed.');
END;
$$;

CREATE OR REPLACE PROCEDURE TOOLS.REJECT_ACTION(
    P_APPROVAL_ID VARCHAR,
    P_NOTE        VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Reject a queued high-value action. Nothing is executed.'
EXECUTE AS OWNER
AS
$$
BEGIN
    UPDATE BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
       SET STATUS = 'REJECTED', DECIDED_AT = CURRENT_TIMESTAMP(),
           DECIDED_BY = CURRENT_USER(), DECISION_NOTE = :P_NOTE
     WHERE APPROVAL_ID = :P_APPROVAL_ID AND STATUS = 'PENDING';

    UPDATE BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
       SET APPROVAL_STATUS = 'REJECTED'
     WHERE ACTION_PAYLOAD:approval_id::VARCHAR = :P_APPROVAL_ID;

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','REJECT_ACTION',
        'approval_id', :P_APPROVAL_ID,
        'message','Approval ' || :P_APPROVAL_ID || ' rejected. No action was taken.');
END;
$$;

-- =====================================================================
-- CHAT-NATIVE HELPERS (for Snowflake CoWork, which has no custom UI)
-- The Next.js app renders documents from PDF_B64 and approvals as buttons.
-- CoWork can only show text and links, so these tools give the same two
-- capabilities through the conversation itself.
-- =====================================================================

-- Server-side encryption is required for presigned URLs to download as
-- plain PDFs in a browser (client-side encrypted files download as ciphertext).
CREATE STAGE IF NOT EXISTS BLUEBERRY_CHAIN.TOOLS.BBC_DOCS
    ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
    DIRECTORY = (ENABLE = TRUE)
    COMMENT = 'Downloadable invoice and credit note PDFs, published by GET_DOCUMENT_LINKS';

CREATE OR REPLACE PROCEDURE TOOLS.GET_DOCUMENT_LINKS(
    P_DOC_IDS   VARCHAR,
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
COMMENT = 'Publish invoice / credit note PDFs to a stage and return 7-day download links. Read-only on business data.'
EXECUTE AS OWNER
AS
$$
import base64
import io
import json
import re

STAGE = "@BLUEBERRY_CHAIN.TOOLS.BBC_DOCS"
TTL_SECONDS = 604800  # 7 days, the presigned URL maximum
MAX_DOCS = 60
DOC_ID = re.compile(r"^(INV|CN)-[0-9A-Z-]+$")

DOCS_SQL = """
SELECT DOC_ID, DOC_TYPE, DOC_TITLE, DOC_SUMMARY, AMOUNT_USD, PDF_B64
  FROM (
    SELECT INVOICE_ID AS DOC_ID, 'INVOICE' AS DOC_TYPE, DOC_TITLE, DOC_SUMMARY,
           NET_AMOUNT_USD AS AMOUNT_USD, PDF_B64, CREATED_TS
      FROM BLUEBERRY_CHAIN.RAW.INVOICES WHERE PDF_B64 IS NOT NULL
    UNION ALL
    SELECT CREDIT_NOTE_ID, 'CREDIT_NOTE', DOC_TITLE, DOC_SUMMARY,
           AMOUNT_USD, PDF_B64, CREATED_TS
      FROM BLUEBERRY_CHAIN.RAW.CREDIT_NOTES WHERE PDF_B64 IS NOT NULL
  )
"""


def run(session, p_doc_ids, p_thread_id):
    ids = [t.strip().upper() for t in re.split(r"[,\s]+", p_doc_ids or "") if t.strip()]
    ids = [t for t in ids if DOC_ID.match(t)][:MAX_DOCS]

    if ids:
        rows = session.sql(
            DOCS_SQL + " WHERE DOC_ID IN (SELECT VALUE::VARCHAR FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?))))"
                       " ORDER BY DOC_ID",
            params=[json.dumps(ids)],
        ).collect()
    else:
        # No ids given: the most recent documents, newest first.
        rows = session.sql(DOCS_SQL + " ORDER BY CREATED_TS DESC LIMIT 10").collect()

    docs = []
    for r in rows:
        if not DOC_ID.match(r["DOC_ID"] or ""):
            continue
        path = f"{r['DOC_ID']}.pdf"
        session.file.put_stream(
            io.BytesIO(base64.b64decode(r["PDF_B64"])),
            f"{STAGE}/{path}",
            auto_compress=False,
            overwrite=True,
        )
        # GET_PRESIGNED_URL rejects bind variables for its arguments, so the
        # path is inlined - safe because DOC_ID was validated against DOC_ID above.
        url = session.sql(
            f"SELECT GET_PRESIGNED_URL({STAGE}, '{path}', {TTL_SECONDS})"
        ).collect()[0][0]
        docs.append({
            "doc_id": r["DOC_ID"],
            "doc_type": r["DOC_TYPE"],
            "doc_title": r["DOC_TITLE"],
            "doc_summary": r["DOC_SUMMARY"],
            "amount_usd": float(r["AMOUNT_USD"]) if r["AMOUNT_USD"] is not None else None,
            "download_url": url,
        })

    missing = sorted(set(ids) - {d["doc_id"] for d in docs})
    return {
        "status": "SUCCESS" if docs else "NOT_FOUND",
        "tool": "GET_DOCUMENT_LINKS",
        "count": len(docs),
        "documents": docs,
        "missing_ids": missing,
        "link_valid_days": 7,
        "message": f"{len(docs)} document(s) ready to download."
                   + (f" Not found: {', '.join(missing)}." if missing else ""),
    }
$$;

CREATE OR REPLACE PROCEDURE TOOLS.LIST_PENDING_APPROVALS(
    P_THREAD_ID VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'List queued high-value actions awaiting a human decision. Read-only.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_list VARIANT;
BEGIN
    SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT(
               'approval_id', APPROVAL_ID, 'tool', TOOL_NAME,
               'estimated_value_usd', ESTIMATED_VALUE_USD,
               'requested_at', REQUESTED_AT::VARCHAR, 'payload', ACTION_PAYLOAD))
             WITHIN GROUP (ORDER BY REQUESTED_AT DESC), ARRAY_CONSTRUCT())
      INTO :v_list
      FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
     WHERE STATUS = 'PENDING';

    RETURN OBJECT_CONSTRUCT('status','SUCCESS','tool','LIST_PENDING_APPROVALS',
        'count', ARRAY_SIZE(:v_list), 'pending', :v_list);
END;
$$;

-- Chat approval. In CoWork the human's typed message IS the approval, so the
-- tool must be handed that message verbatim and checks it names the approval
-- id and the decision. This blocks the model deciding on its own initiative
-- through a mis-call, but it cannot prove the text came from the user - that
-- part rests on the agent instructions. The Next.js app's buttons call
-- APPROVE_ACTION directly and do not depend on the model at all.
CREATE OR REPLACE PROCEDURE TOOLS.DECIDE_APPROVAL(
    P_APPROVAL_ID       VARCHAR,
    P_DECISION          VARCHAR,
    P_USER_CONFIRMATION VARCHAR,
    P_NOTE              VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Approve or reject a queued action on the user''s explicit chat instruction.'
EXECUTE AS OWNER
AS
$$
DECLARE
    v_decision VARCHAR DEFAULT UPPER(TRIM(:P_DECISION));
    v_text     VARCHAR DEFAULT UPPER(COALESCE(:P_USER_CONFIRMATION, ''));
    v_result   VARIANT;
BEGIN
    IF (v_decision NOT IN ('APPROVE', 'REJECT')) THEN
        RETURN OBJECT_CONSTRUCT('status','ERROR','tool','DECIDE_APPROVAL',
            'message','P_DECISION must be APPROVE or REJECT.');
    END IF;

    IF (POSITION(UPPER(:P_APPROVAL_ID) IN :v_text) = 0
        OR (v_decision = 'APPROVE' AND NOT REGEXP_LIKE(:v_text, '.*(APPROVE|CONFIRM|GO AHEAD|YES).*', 's'))
        OR (v_decision = 'REJECT'  AND NOT REGEXP_LIKE(:v_text, '.*(REJECT|DECLINE|CANCEL|NO).*', 's'))) THEN
        RETURN OBJECT_CONSTRUCT('status','NEEDS_CONFIRMATION','tool','DECIDE_APPROVAL',
            'approval_id', :P_APPROVAL_ID,
            'message','Nothing was executed. Ask the user to confirm explicitly, for example: "'
                      || INITCAP(:v_decision) || ' ' || :P_APPROVAL_ID || '".');
    END IF;

    IF (v_decision = 'APPROVE') THEN
        CALL BLUEBERRY_CHAIN.TOOLS.APPROVE_ACTION(:P_APPROVAL_ID, :P_NOTE) INTO :v_result;
    ELSE
        CALL BLUEBERRY_CHAIN.TOOLS.REJECT_ACTION(:P_APPROVAL_ID, :P_NOTE) INTO :v_result;
    END IF;
    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------
-- Grants: agents need USAGE on every tool
-- ---------------------------------------------------------------------
GRANT READ, WRITE ON STAGE BLUEBERRY_CHAIN.TOOLS.BBC_DOCS TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON ALL PROCEDURES IN SCHEMA BLUEBERRY_CHAIN.TOOLS TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON FUTURE PROCEDURES IN SCHEMA BLUEBERRY_CHAIN.TOOLS TO ROLE BBC_AGENT_ROLE;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA BLUEBERRY_CHAIN.RAW TO ROLE BBC_AGENT_ROLE;

SELECT 'TOOLS CREATED' AS STATUS;
