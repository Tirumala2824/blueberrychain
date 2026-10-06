-- WP3 checks: ingest, operational facts and thermal state.
-- Run after a simulator run has flowed through the connectors (Day 3/4 checkpoints);
-- on empty tables every test passes trivially except the grants and DT-state tests.

-- test: connectors hold no table privileges - RAW is reachable only through API.INGEST_BATCH
SHOW GRANTS TO ROLE BBC_INGEST;
SELECT "privilege", "granted_on", "name" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "granted_on" IN ('TABLE', 'VIEW', 'DYNAMIC_TABLE')
   OR ("granted_on" = 'PROCEDURE' AND "name" NOT LIKE 'BBC_OS.API.INGEST_BATCH(%'
       AND "name" NOT LIKE 'BBC_OS.API.GET_CONNECTOR_STATE(%');

-- test: no device reports twice for the same instant
SELECT device_id, reading_ts, COUNT(*) AS n FROM BBC_OS.RAW.TELEMETRY
GROUP BY device_id, reading_ts HAVING COUNT(*) > 1;

-- test: business-event idempotency keys are unique (the primary key is not enforced)
SELECT idempotency_key, COUNT(*) AS n FROM BBC_OS.RAW.BUSINESS_EVENTS
GROUP BY idempotency_key HAVING COUNT(*) > 1;

-- test: every stored telemetry key is the canonical hash of its device and instant
SELECT device_id, reading_ts, idempotency_key FROM BBC_OS.RAW.TELEMETRY
WHERE idempotency_key <> BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_CONSTRUCT(
        'kind', 'TELEMETRY', 'device_id', device_id,
        'reading_ts', TO_CHAR(CONVERT_TIMEZONE('UTC', reading_ts), 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"')));

-- test: a lot has at most one PRIMARY probe at any moment
SELECT a.target_id AS lot_id, a.assignment_id, b.assignment_id AS overlapping_assignment
FROM BBC_OS.OPS.DEVICE_ASSIGNMENTS a
JOIN BBC_OS.OPS.DEVICE_ASSIGNMENTS b
  ON a.target_type = 'LOT' AND b.target_type = 'LOT' AND a.role = 'PRIMARY' AND b.role = 'PRIMARY'
 AND a.target_id = b.target_id AND a.assignment_id < b.assignment_id
 AND a.assigned_from < COALESCE(b.assigned_to, '9999-12-31'::TIMESTAMP_TZ)
 AND b.assigned_from < COALESCE(a.assigned_to, '9999-12-31'::TIMESTAMP_TZ);

-- test: a device measures one target at a time
SELECT a.device_id, a.assignment_id, b.assignment_id AS overlapping_assignment
FROM BBC_OS.OPS.DEVICE_ASSIGNMENTS a
JOIN BBC_OS.OPS.DEVICE_ASSIGNMENTS b
  ON a.device_id = b.device_id AND a.assignment_id < b.assignment_id
 AND a.assigned_from < COALESCE(b.assigned_to, '9999-12-31'::TIMESTAMP_TZ)
 AND b.assigned_from < COALESCE(a.assigned_to, '9999-12-31'::TIMESTAMP_TZ);

-- test: each lot has at most one physics reading per instant
SELECT lot_id, reading_ts, COUNT(*) AS n FROM BBC_OS.OPS.TELEMETRY_ASSIGNED
GROUP BY lot_id, reading_ts HAVING COUNT(*) > 1;

-- test: every pulp reading of an assigned PRIMARY probe reaches the lot physics
SELECT t.device_id, t.reading_ts
FROM BBC_OS.RAW.TELEMETRY t
JOIN BBC_OS.OPS.DEVICE_ASSIGNMENTS a
  ON a.device_id = t.device_id AND a.target_type = 'LOT' AND a.role = 'PRIMARY'
 AND t.reading_ts > a.assigned_from AND (a.assigned_to IS NULL OR t.reading_ts <= a.assigned_to)
JOIN BBC_OS.OPS.LOTS l ON l.lot_id = a.target_id
WHERE t.readings:pulp_c IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.TELEMETRY_ASSIGNED x
                  WHERE x.lot_id = a.target_id AND x.reading_ts = t.reading_ts);

-- test: per-reading physics in the Dynamic Table equals the physics UDF
SELECT ta.lot_id, ta.reading_ts, ta.rate
FROM BBC_OS.OPS.TELEMETRY_ASSIGNED ta
JOIN BBC_OS.OPS.LOTS l ON l.lot_id = ta.lot_id
JOIN BBC_OS.REF.PRODUCTS pr ON pr.product_id = l.product_id AND pr.is_current
WHERE ABS(ta.rate - BBC_OS.OPS.SHELF_LIFE_RATE(ta.pulp_c, pr.tref_c, pr.q10)) > 1e-9;

-- test: 15-minute buckets add up to the lot totals
WITH b AS (
  SELECT lot_id, SUM(readings) AS readings, SUM(consumed_h) AS consumed_h, SUM(excess_h) AS excess_h,
         SUM(breach_min) AS breach_min
  FROM BBC_OS.OPS.LOT_THERMAL_BUCKETS GROUP BY lot_id
)
SELECT s.lot_id FROM BBC_OS.OPS.LOT_THERMAL_STATE s JOIN b ON b.lot_id = s.lot_id
WHERE s.readings <> b.readings OR ABS(s.consumed_h - b.consumed_h) > 1e-6
   OR ABS(s.excess_h - b.excess_h) > 1e-6 OR ABS(s.breach_min - b.breach_min) > 1e-6;

-- test: custody shares of attributable excess sum to 1 per lot (and are NULL when there is none)
SELECT lot_id, SUM(excess_life_share) AS total_share, SUM(attributable_excess_h) AS attributable_excess_h
FROM BBC_OS.OPS.LOT_CUSTODY_EXPOSURE
GROUP BY lot_id
HAVING (SUM(attributable_excess_h) > 0 AND ABS(SUM(excess_life_share) - 1) > 1e-9)
    OR (SUM(attributable_excess_h) = 0 AND COUNT(excess_life_share) > 0);

-- test: attributable excess never exceeds excess
SELECT lot_id, holder_party_id FROM BBC_OS.OPS.LOT_CUSTODY_EXPOSURE
WHERE attributable_excess_h > excess_h + 1e-12 OR attributable_excess_h < 0;

-- test: remaining shelf life never exceeds the reference life, and coverage is a percentage
SELECT s.lot_id, s.remaining_shelf_life_days, s.monitoring_coverage_pct
FROM BBC_OS.OPS.LOT_THERMAL_STATE s
JOIN BBC_OS.REF.PRODUCTS pr ON pr.product_id = s.product_id AND pr.is_current
WHERE s.remaining_shelf_life_days > pr.ref_shelf_life_days
   OR s.monitoring_coverage_pct < 0 OR s.monitoring_coverage_pct > 100;

-- test: every OPS Dynamic Table is scheduled (ALTER DYNAMIC TABLE ... RESUME after a cost pause)
SHOW DYNAMIC TABLES IN SCHEMA BBC_OS.OPS;
SELECT "name", "scheduling_state", "refresh_mode" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "scheduling_state" <> 'ACTIVE';
