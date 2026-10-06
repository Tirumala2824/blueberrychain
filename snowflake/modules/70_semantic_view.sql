-- =============================================================================
-- BlueberryChain OS - WP5: semantic view SEM.EXCURSION_RECOVERY (live layer)
-- Generated from snowflake/semantic/excursion_recovery.yaml by
-- `uv run python -m blueberrychain.sqlgen` - edit the YAML, not this file.
-- Governed metrics carry a definition hash in the policy's metric_registry
-- (blueberrychain.semantic.definition_hashes).
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.SEM;

CREATE OR REPLACE VIEW BBC_OS.SEM.CURRENT_PRODUCTS AS
SELECT product_id, variety, pack, organic, ref_shelf_life_days, tref_c, q10, threshold_c,
       version AS product_version
FROM BBC_OS.REF.PRODUCTS WHERE is_current;

CREATE OR REPLACE VIEW BBC_OS.SEM.CURRENT_PARTIES AS
SELECT party_id, party_type, name, customer_tier FROM BBC_OS.REF.PARTIES WHERE is_current;

CREATE OR REPLACE VIEW BBC_OS.SEM.CURRENT_SITES AS
SELECT site_id, party_id, site_type, name, city, state FROM BBC_OS.REF.SITES WHERE is_current;

CREATE OR REPLACE VIEW BBC_OS.SEM.INVENTORY_POSITIONS AS
-- Stock per site, lot and snapshot by stock type; allocated = open deliveries not yet goods-issued.
WITH s AS (
  SELECT site_id, lot_id, product_id, snapshot_at,
         SUM(IFF(stock_status = 'UNRESTRICTED', kg, 0)) AS unrestricted_kg,
         SUM(IFF(stock_status = 'BLOCKED', kg, 0))      AS blocked_kg,
         SUM(IFF(stock_status = 'QUALITY', kg, 0))      AS quality_kg,
         SUM(IFF(stock_status = 'IN_TRANSIT', kg, 0))   AS in_transit_kg
  FROM BBC_OS.OPS.INVENTORY_SNAPSHOTS
  GROUP BY site_id, lot_id, product_id, snapshot_at
),
a AS (
  SELECT lot_id, SUM(kg) AS allocated_kg
  FROM BBC_OS.OPS.DELIVERIES WHERE status IN ('CREATED', 'PICKED')
  GROUP BY lot_id
)
SELECT s.*, COALESCE(a.allocated_kg, 0) AS allocated_kg,
       GREATEST(s.unrestricted_kg - COALESCE(a.allocated_kg, 0), 0) AS atp_kg
FROM s LEFT JOIN a ON a.lot_id = s.lot_id;

CREATE OR REPLACE VIEW BBC_OS.SEM.LOT_THERMAL AS
SELECT * RENAME (remaining_shelf_life_days AS remaining_days) FROM BBC_OS.OPS.LOT_THERMAL_STATE;

CREATE OR REPLACE VIEW BBC_OS.SEM.CUSTODY_EXPOSURE AS
SELECT * RENAME (excess_life_share AS share) FROM BBC_OS.OPS.LOT_CUSTODY_EXPOSURE;

CREATE OR REPLACE VIEW BBC_OS.SEM.CASE_FACTS AS
SELECT case_id, decision_point, state AS case_state, severity, holder_type_at_onset,
       DATE(CONVERT_TIMEZONE('UTC', detected_at)) AS detected_date,
       DATEDIFF('second', onset_at, detected_at) / 60 AS detect_min, 1 AS one
FROM BBC_OS.DECISION.CASES;

CREATE OR REPLACE VIEW BBC_OS.SEM.DECISIONS AS
SELECT rec_id, case_id, decision_point, decided_by, policy_outcome, autonomy_level, option_key,
       planned_value_usd AS planned_usd, default_counterfactual_usd AS default_nrv_usd,
       value_at_risk_usd AS risk_usd, predicted_nrv_usd AS chosen_nrv_usd,
       time_to_decision_min AS decide_min, approval_latency_min AS approve_min,
       IFF(decided_by = 'RULE', 1, 0) AS by_rule, IFF(decided_by = 'AGENT', 1, 0) AS by_agent,
       IFF(alternatives_chosen > 0, 1, 0) AS overridden,
       IFF(approvals_requested > 0, 1, NULL) AS approval_needed
FROM BBC_OS.DECISION.V_DECISIONS WHERE status <> 'SUPERSEDED';

CREATE OR REPLACE SEMANTIC VIEW BBC_OS.SEM.EXCURSION_RECOVERY
  TABLES (
    lots AS BBC_OS.OPS.LOTS PRIMARY KEY (lot_id) COMMENT = 'Harvest lots.',
    products AS BBC_OS.SEM.CURRENT_PRODUCTS PRIMARY KEY (product_id) COMMENT = 'Products with their current shelf-life parameters.',
    growers AS BBC_OS.SEM.CURRENT_PARTIES PRIMARY KEY (party_id) COMMENT = 'The grower of a lot.',
    holders AS BBC_OS.SEM.CURRENT_PARTIES PRIMARY KEY (party_id) COMMENT = 'A custody holder.',
    customers AS BBC_OS.SEM.CURRENT_PARTIES PRIMARY KEY (party_id) COMMENT = 'The customer on an order line.',
    carriers AS BBC_OS.SEM.CURRENT_PARTIES PRIMARY KEY (party_id) COMMENT = 'The carrier of a shipment.',
    sites AS BBC_OS.SEM.CURRENT_SITES PRIMARY KEY (site_id) COMMENT = 'Stock locations.',
    lot_thermal AS BBC_OS.SEM.LOT_THERMAL PRIMARY KEY (lot_id) COMMENT = 'Lot physics as of the last reading.',
    custody_exposure AS BBC_OS.SEM.CUSTODY_EXPOSURE PRIMARY KEY (lot_id, holder_party_id) COMMENT = 'Lot physics per custody holder.',
    shipments AS BBC_OS.OPS.SHIPMENTS PRIMARY KEY (shipment_id) COMMENT = 'Shipments with their current status.',
    shipment_lots AS BBC_OS.OPS.SHIPMENT_LOTS PRIMARY KEY (shipment_id, lot_id) COMMENT = 'Lots on shipments (bridge).',
    order_lines AS BBC_OS.OPS.ORDER_LINES PRIMARY KEY (order_line_id) COMMENT = 'Customer order lines.',
    inventory AS BBC_OS.SEM.INVENTORY_POSITIONS PRIMARY KEY (site_id, lot_id, snapshot_at) COMMENT = 'Stock positions per snapshot (semi-additive over snapshot_at).',
    cases AS BBC_OS.SEM.CASE_FACTS PRIMARY KEY (case_id) COMMENT = 'Recovery Cases (one excursion episode each).',
    decisions AS BBC_OS.SEM.DECISIONS PRIMARY KEY (rec_id) COMMENT = 'Recommendations with their values, verdict and approval latency (one per decision).'
  )
  RELATIONSHIPS (
    lot_product AS lots (product_id) REFERENCES products,
    lot_grower AS lots (grower_party_id) REFERENCES growers,
    thermal_lot AS lot_thermal (lot_id) REFERENCES lots,
    exposure_lot AS custody_exposure (lot_id) REFERENCES lots,
    exposure_holder AS custody_exposure (holder_party_id) REFERENCES holders,
    shipment_carrier AS shipments (carrier_party_id) REFERENCES carriers,
    shipment_lot_shipment AS shipment_lots (shipment_id) REFERENCES shipments,
    shipment_lot_lot AS shipment_lots (lot_id) REFERENCES lots,
    order_customer AS order_lines (customer_party_id) REFERENCES customers,
    order_lot AS order_lines (assigned_lot_id) REFERENCES lots,
    inventory_lot AS inventory (lot_id) REFERENCES lots,
    inventory_site AS inventory (site_id) REFERENCES sites,
    decision_case AS decisions (case_id) REFERENCES cases
  )
  FACTS (
    lot_thermal.remaining_days AS lot_thermal.remaining_days,
    lot_thermal.monitored_min AS lot_thermal.monitored_min,
    lot_thermal.breach_min AS lot_thermal.breach_min,
    lot_thermal.elapsed_h AS lot_thermal.elapsed_h,
    lot_thermal.as_of AS lot_thermal.as_of,
    custody_exposure.attributable_excess_h AS custody_exposure.attributable_excess_h,
    custody_exposure.share AS custody_exposure.share,
    custody_exposure.degree_min_above AS custody_exposure.degree_min_above,
    shipment_lots.kg AS shipment_lots.kg,
    order_lines.kg AS order_lines.kg,
    order_lines.value_usd AS order_lines.kg * order_lines.price_usd_per_kg,
    inventory.atp_kg AS inventory.atp_kg,
    cases.one AS cases.one,
    cases.detect_min AS cases.detect_min,
    decisions.planned_usd AS decisions.planned_usd,
    decisions.default_nrv_usd AS decisions.default_nrv_usd,
    decisions.risk_usd AS decisions.risk_usd,
    decisions.chosen_nrv_usd AS decisions.chosen_nrv_usd,
    decisions.decide_min AS decisions.decide_min,
    decisions.approve_min AS decisions.approve_min,
    decisions.by_rule AS decisions.by_rule,
    decisions.by_agent AS decisions.by_agent,
    decisions.overridden AS decisions.overridden,
    decisions.approval_needed AS decisions.approval_needed
  )
  DIMENSIONS (
    lots.lot_id AS lots.lot_id,
    lots.harvest_date AS DATE(CONVERT_TIMEZONE('UTC', lots.harvest_at)) COMMENT = 'UTC harvest date',
    lots.organic AS lots.organic,
    products.product_id AS products.product_id,
    products.variety AS products.variety,
    growers.grower_name AS growers.name,
    holders.holder_party_id AS holders.party_id,
    holders.holder_type AS holders.party_type WITH SYNONYMS = ('custody holder type'),
    holders.holder_name AS holders.name,
    customers.customer_name AS customers.name,
    customers.customer_tier AS customers.customer_tier,
    carriers.carrier_name AS carriers.name,
    sites.site_id AS sites.site_id,
    sites.site_name AS sites.name,
    shipments.shipment_id AS shipments.shipment_id,
    shipments.shipment_status AS shipments.status,
    shipments.destination_site_id AS shipments.destination_site_id,
    order_lines.order_line_id AS order_lines.order_line_id,
    order_lines.order_status AS order_lines.status,
    inventory.snapshot_at AS inventory.snapshot_at COMMENT = 'Stock snapshot time; inventory metrics never sum across it',
    cases.case_id AS cases.case_id,
    cases.case_state AS cases.case_state,
    cases.severity AS cases.severity,
    cases.holder_type_at_onset AS cases.holder_type_at_onset WITH SYNONYMS = ('custody holder at onset'),
    cases.detected_date AS cases.detected_date COMMENT = 'UTC date of detection (event time)',
    decisions.rec_id AS decisions.rec_id,
    decisions.decision_point AS decisions.decision_point,
    decisions.decided_by AS decisions.decided_by WITH SYNONYMS = ('decider kind') COMMENT = 'RULE',
    decisions.policy_outcome AS decisions.policy_outcome COMMENT = 'AUTO',
    decisions.chosen_option AS decisions.option_key
  )
  METRICS (
    lot_thermal.remaining_shelf_life_days AS MIN(lot_thermal.remaining_days) COMMENT = 'Saleable life left as of the last reading. At lot grain, the lot''s value; across lots, the worst lot - never a sum.',
    custody_exposure.excess_life_share AS MAX(custody_exposure.share) COMMENT = 'Share of the lot''s attributable excess life that occurred in this holder''s custody (lot x holder grain). Attribution, not liability.',
    inventory.quality_adjusted_atp_kg NON ADDITIVE BY (inventory.snapshot_at ASC) AS SUM(inventory.atp_kg) COMMENT = 'Unrestricted stock minus open allocations, at the latest snapshot only.',
    lot_thermal.temperature_compliance_pct AS 100 * (1 - SUM(lot_thermal.breach_min) / NULLIF(SUM(lot_thermal.monitored_min), 0)) COMMENT = 'Monitored minutes at or below the threshold (minute-weighted; pair with coverage).',
    lot_thermal.monitoring_coverage_pct AS 100 * SUM(lot_thermal.monitored_min) / 60 / NULLIF(SUM(lot_thermal.elapsed_h), 0) COMMENT = 'Share of lot age with readings.',
    custody_exposure.thermal_exposure_deg_h AS SUM(custody_exposure.degree_min_above) / 60 COMMENT = 'Degree-hours above the threshold (lot x holder grain; not meaningful summed across lots).',
    lot_thermal.data_age_min AS DATEDIFF('minute', MAX(lot_thermal.as_of), CURRENT_TIMESTAMP()) COMMENT = 'Minutes since the newest reading.',
    shipment_lots.kg_on_shipments AS SUM(shipment_lots.kg) COMMENT = 'kg on shipments; filter on shipments.shipment_status (e.g. IN_TRANSIT).',
    order_lines.order_value_usd AS SUM(order_lines.value_usd) COMMENT = 'Order-line value at contract price.',
    decisions.planned_value_usd AS SUM(decisions.planned_usd) COMMENT = 'Contract value of the case lots as planned (kg x order price).',
    decisions.default_counterfactual_usd AS SUM(decisions.default_nrv_usd) COMMENT = 'Expected net realisable value of doing nothing, scored ex ante with the chosen option.',
    decisions.value_at_risk_usd AS SUM(decisions.risk_usd) COMMENT = 'Planned value minus the expected value of doing nothing.',
    decisions.predicted_nrv_usd AS SUM(decisions.chosen_nrv_usd) COMMENT = 'Expected net realisable value of the chosen option.',
    decisions.time_to_decision_min AS AVG(decisions.decide_min) COMMENT = 'Case opened to recommendation (wall clock).',
    decisions.approval_latency_min AS AVG(decisions.approve_min) COMMENT = 'Approval requested to decided, slowest role per decision (wall clock).',
    decisions.rule_decided_share AS AVG(decisions.by_rule) COMMENT = 'Share of decisions made by the rule (no LLM).',
    decisions.agent_decided_share AS AVG(decisions.by_agent) COMMENT = 'Share of decisions chosen by an agent among non-dominated options.',
    decisions.human_override_rate AS AVG(decisions.overridden * decisions.approval_needed) COMMENT = 'Among decisions that needed approval, the share where an approver chose another option.',
    cases.case_count AS SUM(cases.one) COMMENT = 'Recovery Cases.',
    cases.time_to_detect_min AS AVG(cases.detect_min) COMMENT = 'Breach onset to the reading at which the detection rule held (event time).'
  )
  COMMENT = 'Excursion Value Recovery - live layer. Every canonical metric is defined here once and governed by GOV.METRIC_REGISTRY (definition_hash). Physics is pre-aggregated per lot in OPS, so cross-lot sums of shelf life or exposure do not exist in this model.'
  AI_SQL_GENERATION 'Never sum remaining shelf life, exposure or shares across lots. Never sum inventory across snapshot times. Use the metrics as defined; do not recompute physics. Options are mutually exclusive alternatives: decision values describe the chosen option only.';
