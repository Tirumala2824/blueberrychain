-- =============================================================================
-- BlueberryChain OS - WP2 step 1: code stage for Python packages
-- Run as BBC_OWNER. Then upload the packages:  uv run bbc deploy python
-- Procedures import them as '@BBC_OS.GOV.CODE/<package>/<version>/<package>-<version>.zip'.
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;

CREATE STAGE IF NOT EXISTS BBC_OS.GOV.CODE
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  COMMENT = 'Versioned Python packages (bbc_toolkit, bbc_engine) imported by procedures. Written only by bbc deploy python.';
