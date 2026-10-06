-- =============================================================================
-- BlueberryChain OS - WP3: thermal state, continuously, at the right grain
-- Physics definitions: python/bbc_engine/src/bbc_engine/physics.py (module docstring).
--   rate(T)      = Q10 ^ ((T - Tref) / 10)
--   consumed_h   = rate(T) * interval_h                      (reference hours)
--   excess_h     = max(rate(T) - rate(threshold), 0) * interval_h
--   attributable = excess_h outside the grower's contractual pre-cool window (harvest + precool_max_hours)
--   breach_min   = interval_min when T > threshold
--   remaining    = ref_life_h - consumed_h - unmonitored_h * rate(T_assumed), as of the last reading
-- A reading at reading_ts covers (reading_ts - interval_s, reading_ts], so it belongs to the
-- assignment and custody holder in force just before reading_ts: hence the strict '>' on every
-- interval start and '<=' against its end (next start, assigned_to).
-- Only the lot's PRIMARY pulp probe drives lot physics. Reefer readings are kept as
-- evidence (OPS.REEFER_TELEMETRY), never fanned out into lot physics.
--
-- Spike S1 FALLBACK (ADR-0002): ASOF JOIN is rejected in an incremental Dynamic Table on this
-- account ("Change tracking is not supported on queries with joins of type [ASOF_JOIN]"), so
-- assignments and custody events become intervals (start, next start] and readings range-join
-- them. A reading matches the interval whose start is the latest one strictly before
-- reading_ts - exactly the ASOF semantics, and the tables stay incremental.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.OPS;

-- Custody per lot: lot-level events, plus shipment-level events applied to every lot on it.
CREATE OR REPLACE DYNAMIC TABLE LOT_CUSTODY
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Custody events expanded to lot level: who holds each lot from each event on.'
AS
SELECT e.event_id, e.lot_id, e.at, e.event_type, e.from_party_id, e.to_party_id, e.site_id, e.shipment_id
FROM CUSTODY_EVENTS e
WHERE e.lot_id IS NOT NULL
UNION ALL
SELECT e.event_id, sl.lot_id, e.at, e.event_type, e.from_party_id, e.to_party_id, e.site_id, e.shipment_id
FROM CUSTODY_EVENTS e
JOIN SHIPMENT_LOTS sl ON sl.shipment_id = e.shipment_id
WHERE e.lot_id IS NULL;

-- Each device assignment is in force from assigned_from until the device's next assignment starts.
CREATE OR REPLACE DYNAMIC TABLE DEVICE_ASSIGNMENT_INTERVALS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Device assignments with next_from (the start of the device''s next assignment; NULL = latest).'
AS
SELECT a.assignment_id, a.device_id, a.target_type, a.target_id, a.role, a.assigned_from, a.assigned_to,
       LEAD(a.assigned_from) OVER (PARTITION BY a.device_id ORDER BY a.assigned_from, a.assignment_id) AS next_from
FROM DEVICE_ASSIGNMENTS a;

-- Each custody event's holder holds the lot until the lot's next custody event. Every lot opens
-- with a sentinel interval in which its grower holds it (before any handoff the grower holds the
-- lot), so readings inner-join custody: incremental refresh rejects outer joins on ranges.
CREATE OR REPLACE DYNAMIC TABLE LOT_CUSTODY_INTERVALS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Lot custody intervals (at, next_at]; the first row per lot is the grower from the start (event_id NULL).'
AS
WITH events AS (
  SELECT c.event_id, c.lot_id, c.at, c.to_party_id, c.site_id FROM LOT_CUSTODY c
  UNION ALL
  SELECT NULL, l.lot_id, '1900-01-01 00:00:00 +00:00'::TIMESTAMP_TZ, l.grower_party_id, NULL FROM LOTS l
)
SELECT e.event_id, e.lot_id, e.at, e.to_party_id, e.site_id,
       LEAD(e.at) OVER (PARTITION BY e.lot_id ORDER BY e.at, e.event_id) AS next_at
FROM events e;

-- One row per PRIMARY probe reading, with its lot, its custody holder at that moment and its physics.
CREATE OR REPLACE DYNAMIC TABLE TELEMETRY_ASSIGNED
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Pulp readings -> lot (device assignment interval) -> custody holder (custody interval), with per-reading physics.'
AS
WITH probe AS (
  SELECT t.device_id, t.reading_ts, t.interval_s, t.readings:pulp_c::FLOAT AS pulp_c,
         t.received_at, t.idempotency_key, a.target_id AS lot_id, a.assignment_id
  FROM BBC_OS.RAW.TELEMETRY t
  JOIN DEVICE_ASSIGNMENT_INTERVALS a
    ON t.device_id = a.device_id
   AND t.reading_ts > a.assigned_from
   AND (a.next_from IS NULL OR t.reading_ts <= a.next_from)
  WHERE a.target_type = 'LOT' AND a.role = 'PRIMARY'
    AND (a.assigned_to IS NULL OR t.reading_ts <= a.assigned_to)
    AND t.readings:pulp_c IS NOT NULL
),
held AS (
  SELECT p.*, c.to_party_id AS custody_party_id, c.site_id AS custody_site_id, c.event_id AS custody_event_id
  FROM probe p
  JOIN LOT_CUSTODY_INTERVALS c
    ON p.lot_id = c.lot_id
   AND p.reading_ts > c.at
   AND (c.next_at IS NULL OR p.reading_ts <= c.next_at)
)
SELECT
  h.lot_id, h.reading_ts, h.interval_s, h.pulp_c, h.device_id, h.assignment_id, h.idempotency_key, h.received_at,
  COALESCE(h.custody_party_id, l.grower_party_id) AS holder_party_id,   -- before any handoff the grower holds the lot
  h.custody_site_id, h.custody_event_id,
  l.product_id, pr.version AS product_version, pr.threshold_c,
  POWER(pr.q10, (h.pulp_c - pr.tref_c) / 10)                                                    AS rate,
  POWER(pr.q10, (h.pulp_c - pr.tref_c) / 10) * h.interval_s / 3600                              AS consumed_h,
  GREATEST(POWER(pr.q10, (h.pulp_c - pr.tref_c) / 10)
           - POWER(pr.q10, (pr.threshold_c - pr.tref_c) / 10), 0) * h.interval_s / 3600         AS excess_h,
  IFF(h.pulp_c > pr.threshold_c, h.interval_s / 60, 0)                                          AS breach_min,
  GREATEST(h.pulp_c - pr.threshold_c, 0) * h.interval_s / 60                                    AS degree_min_above,
  -- Field heat inside the grower's contractual pre-cool window is expected: physics, not blame.
  h.reading_ts <= DATEADD('second', (COALESCE(g.precool_max_hours, 0) * 3600)::INTEGER, l.harvest_at)     AS in_precool_window
FROM held h
JOIN LOTS l ON l.lot_id = h.lot_id
JOIN BBC_OS.REF.PRODUCTS pr ON pr.product_id = l.product_id AND pr.is_current
LEFT JOIN (
  SELECT party_id, MIN(terms:precool_max_hours::FLOAT) AS precool_max_hours   -- strictest current contract
  FROM BBC_OS.REF.CONTRACTS
  WHERE contract_type = 'GROWER_SUPPLY' AND is_current
  GROUP BY party_id
) g ON g.party_id = l.grower_party_id;

-- Reefer unit readings per shipment: evidence for forensics (setpoint, air, door, alarms, position).
CREATE OR REPLACE DYNAMIC TABLE REEFER_TELEMETRY
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Reefer readings -> shipment (device assignment interval, role REEFER).'
AS
SELECT
  a.target_id AS shipment_id, t.device_id, t.reading_ts, t.interval_s,
  t.readings:supply_air_c::FLOAT AS supply_air_c,
  t.readings:return_air_c::FLOAT AS return_air_c,
  t.readings:setpoint_c::FLOAT   AS setpoint_c,
  t.readings:ambient_c::FLOAT    AS ambient_c,
  t.readings:mode::STRING        AS mode,
  t.readings:door_open::BOOLEAN  AS door_open,
  t.readings:alarms              AS alarms,
  t.readings:lat::FLOAT          AS lat,
  t.readings:lon::FLOAT          AS lon,
  t.received_at
FROM BBC_OS.RAW.TELEMETRY t
JOIN DEVICE_ASSIGNMENT_INTERVALS a
  ON t.device_id = a.device_id
 AND t.reading_ts > a.assigned_from
 AND (a.next_from IS NULL OR t.reading_ts <= a.next_from)
WHERE a.target_type = 'SHIPMENT' AND a.role = 'REEFER'
  AND (a.assigned_to IS NULL OR t.reading_ts <= a.assigned_to);

-- Lot x custody holder x 15 minutes: cheap continuous detection over high-volume telemetry.
CREATE OR REPLACE DYNAMIC TABLE LOT_THERMAL_BUCKETS
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
  COMMENT = 'Per lot, holder and 15-minute bucket: reading/breach minutes, degree-minutes, consumed and excess life, max pulp.'
AS
SELECT
  lot_id, holder_party_id,
  TIME_SLICE(CONVERT_TIMEZONE('UTC', reading_ts)::TIMESTAMP_NTZ, 15, 'MINUTE') AS bucket_start_utc,  -- TIME_SLICE takes no TIMESTAMP_TZ
  COUNT(*)                                           AS readings,
  SUM(interval_s) / 60                               AS reading_min,
  SUM(breach_min)                                    AS breach_min,
  SUM(degree_min_above)                              AS degree_min_above,
  SUM(consumed_h)                                    AS consumed_h,
  SUM(excess_h)                                      AS excess_h,
  SUM(IFF(in_precool_window, 0, excess_h))           AS attributable_excess_h,
  MAX(pulp_c)                                        AS max_pulp_c,
  MIN(pulp_c)                                        AS min_pulp_c,
  MIN(reading_ts)                                    AS first_reading_ts,
  MAX(reading_ts)                                    AS last_reading_ts,
  MIN(IFF(pulp_c <= threshold_c, reading_ts, NULL))  AS first_cold_reading_ts,
  MAX(received_at)                                   AS last_received_at
FROM TELEMETRY_ASSIGNED
GROUP BY lot_id, holder_party_id, TIME_SLICE(CONVERT_TIMEZONE('UTC', reading_ts)::TIMESTAMP_NTZ, 15, 'MINUTE');

-- Lot-level physics as of the last reading: the inputs of REMAINING_SHELF_LIFE_DAYS.
CREATE OR REPLACE DYNAMIC TABLE LOT_THERMAL_STATE
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Per lot, as of its last reading: consumed/excess life, coverage, compliance, remaining shelf life. Never reads the current time.'
AS
WITH agg AS (
  SELECT
    lot_id,
    SUM(readings)               AS readings,
    SUM(reading_min)            AS monitored_min,
    SUM(breach_min)             AS breach_min,
    SUM(degree_min_above)       AS degree_min_above,
    SUM(consumed_h)             AS consumed_h,
    SUM(excess_h)               AS excess_h,
    SUM(attributable_excess_h)  AS attributable_excess_h,
    MAX(max_pulp_c)             AS max_pulp_c,
    MIN(first_reading_ts)       AS first_reading_ts,
    MAX(last_reading_ts)        AS last_reading_ts,
    MIN(first_cold_reading_ts)  AS cold_chain_started_at,
    MAX(last_received_at)       AS last_received_at
  FROM LOT_THERMAL_BUCKETS
  GROUP BY lot_id
)
SELECT
  a.lot_id, l.product_id, pr.version AS product_version, l.kg, l.harvest_at,
  a.readings, a.monitored_min, a.breach_min, a.degree_min_above, a.consumed_h, a.excess_h,
  a.attributable_excess_h, a.max_pulp_c,
  a.first_reading_ts, a.last_reading_ts AS as_of, a.cold_chain_started_at, a.last_received_at,
  DATEDIFF('second', l.harvest_at, a.last_reading_ts)::FLOAT / 3600                         AS elapsed_h,
  GREATEST(DATEDIFF('second', l.harvest_at, a.last_reading_ts)::FLOAT / 3600
           - a.monitored_min / 60, 0)                                                AS unmonitored_h,
  pr.ref_shelf_life_days * 24 - a.consumed_h
    - GREATEST(DATEDIFF('second', l.harvest_at, a.last_reading_ts)::FLOAT / 3600 - a.monitored_min / 60, 0)
      * POWER(pr.q10, (pr.unmonitored_assumed_temp_c - pr.tref_c) / 10)             AS remaining_shelf_life_h,
  (pr.ref_shelf_life_days * 24 - a.consumed_h
    - GREATEST(DATEDIFF('second', l.harvest_at, a.last_reading_ts)::FLOAT / 3600 - a.monitored_min / 60, 0)
      * POWER(pr.q10, (pr.unmonitored_assumed_temp_c - pr.tref_c) / 10)) / 24        AS remaining_shelf_life_days,
  LEAST(a.monitored_min / 60 / NULLIF(DATEDIFF('second', l.harvest_at, a.last_reading_ts)::FLOAT / 3600, 0), 1) * 100
                                                                                     AS monitoring_coverage_pct,
  (1 - a.breach_min / NULLIF(a.monitored_min, 0)) * 100                              AS temperature_compliance_pct
FROM agg a
JOIN LOTS l ON l.lot_id = a.lot_id
JOIN BBC_OS.REF.PRODUCTS pr ON pr.product_id = l.product_id AND pr.is_current;

-- Where the avoidable damage happened: attributable excess life per custody holder, shares sum to 1.
CREATE OR REPLACE DYNAMIC TABLE LOT_CUSTODY_EXPOSURE
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = AUTO
  COMMENT = 'Per lot and custody holder: excess/attributable excess/consumed life, breach and degree minutes, EXCESS_LIFE_SHARE of attributable excess (NULL when there is none).'
AS
SELECT
  b.lot_id, b.holder_party_id, p.party_type AS holder_type,
  SUM(b.reading_min)        AS reading_min,
  SUM(b.breach_min)         AS breach_min,
  SUM(b.degree_min_above)   AS degree_min_above,
  SUM(b.consumed_h)         AS consumed_h,
  SUM(b.excess_h)                AS excess_h,
  SUM(b.attributable_excess_h)   AS attributable_excess_h,
  MAX(b.max_pulp_c)              AS max_pulp_c,
  MIN(b.first_reading_ts)        AS first_reading_ts,
  MAX(b.last_reading_ts)         AS last_reading_ts,
  SUM(b.attributable_excess_h)
    / NULLIF(SUM(SUM(b.attributable_excess_h)) OVER (PARTITION BY b.lot_id), 0) AS excess_life_share
FROM LOT_THERMAL_BUCKETS b
LEFT JOIN BBC_OS.REF.PARTIES p ON p.party_id = b.holder_party_id AND p.is_current
GROUP BY b.lot_id, b.holder_party_id, p.party_type;
