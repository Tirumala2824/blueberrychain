-- =============================================================================
-- BlueberryChain OS - WP3: shelf-life physics as SQL functions
-- Reference implementation: python/bbc_engine/src/bbc_engine/physics.py.
-- snowflake/tests/03_physics_parity.sql (generated from that module) proves equality.
-- The Dynamic Tables in 62_ops_thermal.sql inline the same expression so they stay
-- eligible for incremental refresh; the parity test covers both.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.OPS;

CREATE OR REPLACE FUNCTION SHELF_LIFE_RATE(TEMP_C FLOAT, TREF_C FLOAT, Q10 FLOAT)
  RETURNS FLOAT
  IMMUTABLE
  COMMENT = 'Relative rate of shelf-life consumption: Q10 ^ ((T - Tref) / 10). 1.0 at Tref.'
  AS 'POWER(Q10, (TEMP_C - TREF_C) / 10)';

CREATE OR REPLACE FUNCTION PROJECT_SHELF_LIFE_DAYS(
    REMAINING_H FLOAT, HOURS_AHEAD FLOAT, TEMP_C FLOAT, TREF_C FLOAT, Q10 FLOAT)
  RETURNS FLOAT
  IMMUTABLE
  COMMENT = 'Remaining shelf life (days) after HOURS_AHEAD more hours at TEMP_C.'
  AS '(REMAINING_H - HOURS_AHEAD * POWER(Q10, (TEMP_C - TREF_C) / 10)) / 24';
