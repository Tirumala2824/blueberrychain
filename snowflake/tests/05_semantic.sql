-- WP5 checks: the semantic view returns exactly the governed values.

-- test: every governed metric in the active policy is a metric of SEM.EXCURSION_RECOVERY
DESCRIBE SEMANTIC VIEW BBC_OS.SEM.EXCURSION_RECOVERY;
WITH view_metrics AS (
  SELECT UPPER("object_name") AS name FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "object_kind" = 'METRIC'
)
SELECT r.name AS registry_metric_missing_from_view
FROM BBC_OS.GOV.METRIC_REGISTRY r
WHERE r.policy_version = BBC_OS.GOV.ACTIVE_POLICY_VERSION()
  AND r.definition_hash IS NOT NULL
  AND r.name NOT IN (SELECT name FROM view_metrics);

-- test: remaining shelf life through the semantic view equals the Dynamic Table, lot by lot
WITH sv AS (
  SELECT * FROM SEMANTIC_VIEW(
    BBC_OS.SEM.EXCURSION_RECOVERY
    DIMENSIONS lots.lot_id
    METRICS lot_thermal.remaining_shelf_life_days, lot_thermal.temperature_compliance_pct)
)
SELECT s.lot_id, s.remaining_shelf_life_days AS dt_value, sv.remaining_shelf_life_days AS view_value
FROM BBC_OS.OPS.LOT_THERMAL_STATE s
LEFT JOIN sv ON sv.lot_id = s.lot_id
WHERE sv.lot_id IS NULL
   OR ABS(sv.remaining_shelf_life_days - s.remaining_shelf_life_days) > 1e-9
   OR ABS(sv.temperature_compliance_pct - s.temperature_compliance_pct) > 1e-6;

-- test: custody shares through the semantic view equal the Dynamic Table
WITH sv AS (
  SELECT * FROM SEMANTIC_VIEW(
    BBC_OS.SEM.EXCURSION_RECOVERY
    DIMENSIONS lots.lot_id, holders.holder_party_id
    METRICS custody_exposure.excess_life_share)
)
SELECT e.lot_id, e.holder_party_id
FROM BBC_OS.OPS.LOT_CUSTODY_EXPOSURE e
LEFT JOIN sv ON sv.lot_id = e.lot_id AND sv.holder_party_id = e.holder_party_id
WHERE NOT EQUAL_NULL(ROUND(sv.excess_life_share, 12), ROUND(e.excess_life_share, 12));

-- test: inventory never sums across snapshots - total ATP equals ATP at each lot's latest snapshot
WITH latest AS (
  SELECT site_id, lot_id, atp_kg FROM BBC_OS.SEM.INVENTORY_POSITIONS
  QUALIFY ROW_NUMBER() OVER (PARTITION BY site_id, lot_id ORDER BY snapshot_at DESC) = 1
),
sv AS (
  SELECT * FROM SEMANTIC_VIEW(
    BBC_OS.SEM.EXCURSION_RECOVERY
    DIMENSIONS sites.site_id, lots.lot_id
    METRICS inventory.quality_adjusted_atp_kg)
)
SELECT l.site_id, l.lot_id, l.atp_kg AS latest_snapshot, sv.quality_adjusted_atp_kg AS view_value
FROM latest l
LEFT JOIN sv ON sv.site_id = l.site_id AND sv.lot_id = l.lot_id
WHERE NOT EQUAL_NULL(sv.quality_adjusted_atp_kg, l.atp_kg);
