-- =============================================================================
-- BlueberryChain OS - WP1 capability spikes (throwaway objects in BBC_OS.SANDBOX)
-- Each section answers one question that changes how later work is built.
-- Record every result (PASS / FALLBACK + evidence) in docs/adr/0002-snowflake-capabilities.md.
-- Run as BBC_OWNER unless a section says otherwise. Drop everything at the end.
-- =============================================================================
USE ROLE BBC_OWNER;
USE WAREHOUSE BBC_APP_WH;
CREATE SCHEMA IF NOT EXISTS BBC_OS.SANDBOX COMMENT = 'WP1 spikes - drop after recording results';
USE SCHEMA BBC_OS.SANDBOX;

-- -----------------------------------------------------------------------------
-- S1. ASOF JOIN inside an INCREMENTAL Dynamic Table
--     PASS: refresh_mode = INCREMENTAL.  FALLBACK: interval join (S1b).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE T_READINGS (device_id STRING, reading_ts TIMESTAMP_TZ, pulp_c FLOAT);
CREATE OR REPLACE TABLE T_ASSIGN   (device_id STRING, lot_id STRING, assigned_from TIMESTAMP_TZ, assigned_to TIMESTAMP_TZ);
INSERT INTO T_ASSIGN VALUES
  ('P-1', 'L-1', '2026-10-01 00:00:00 +00:00', '2026-10-02 00:00:00 +00:00'),
  ('P-1', 'L-2', '2026-10-02 00:00:00 +00:00', NULL);
INSERT INTO T_READINGS VALUES
  ('P-1', '2026-10-01 06:00:00 +00:00', 0.6),
  ('P-1', '2026-10-02 06:00:00 +00:00', 3.9);

CREATE OR REPLACE DYNAMIC TABLE DT_ASOF
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
AS
SELECT r.device_id, r.reading_ts, r.pulp_c, a.lot_id
FROM T_READINGS r
ASOF JOIN T_ASSIGN a
  MATCH_CONDITION (r.reading_ts >= a.assigned_from)
  ON r.device_id = a.device_id;

SHOW DYNAMIC TABLES LIKE 'DT_ASOF';          -- record refresh_mode
SELECT * FROM DT_ASOF ORDER BY reading_ts;   -- expect L-1 then L-2

-- S1b (only if S1 is rejected or falls back to FULL): interval join
CREATE OR REPLACE DYNAMIC TABLE DT_INTERVAL
  TARGET_LAG = '1 minute' WAREHOUSE = BBC_TRANSFORM_WH REFRESH_MODE = INCREMENTAL
AS
SELECT r.device_id, r.reading_ts, r.pulp_c, a.lot_id
FROM T_READINGS r
JOIN T_ASSIGN a
  ON r.device_id = a.device_id
 AND r.reading_ts >= a.assigned_from
 AND (a.assigned_to IS NULL OR r.reading_ts < a.assigned_to);
SHOW DYNAMIC TABLES LIKE 'DT_INTERVAL';

-- -----------------------------------------------------------------------------
-- S2. Stream on a Dynamic Table + TRIGGERED task (no schedule)
--     PASS: T_TASK_LOG gets a row within ~2 minutes of new readings.
--     FALLBACK: SCHEDULE = '1 MINUTE' with the same WHEN clause.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE STREAM S_DT_ASOF ON DYNAMIC TABLE DT_ASOF;
CREATE OR REPLACE TABLE T_TASK_LOG (fired_at TIMESTAMP_TZ, new_rows NUMBER);
CREATE OR REPLACE TASK TK_TRIGGERED
  WAREHOUSE = BBC_TRANSFORM_WH
  WHEN SYSTEM$STREAM_HAS_DATA('BBC_OS.SANDBOX.S_DT_ASOF')
AS
  INSERT INTO T_TASK_LOG SELECT CURRENT_TIMESTAMP(), COUNT(*) FROM S_DT_ASOF;
ALTER TASK TK_TRIGGERED RESUME;
INSERT INTO T_READINGS VALUES ('P-1', '2026-10-02 07:00:00 +00:00', 4.4);
-- wait ~2 minutes, then:
SELECT * FROM T_TASK_LOG;
ALTER TASK TK_TRIGGERED SUSPEND;

-- -----------------------------------------------------------------------------
-- S3. Directory-table stream + AI_EXTRACT on a staged PDF
--     Upload first (from the repo root, via snow CLI or CoCo):
--       PUT file://docs/coco-briefs/assets/sample_inspection_cert.pdf @BBC_OS.SANDBOX.DOCS AUTO_COMPRESS = FALSE;
--     PASS: stream shows the file; AI_EXTRACT returns lot L-2291, 1.0 C, 2026-10-03 06:40.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE STAGE DOCS
  DIRECTORY = (ENABLE = TRUE)
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');
CREATE OR REPLACE STREAM S_DOCS ON STAGE DOCS;
-- (PUT the file here)
ALTER STAGE DOCS REFRESH;
SELECT relative_path, size, metadata$action FROM S_DOCS;
SELECT AI_EXTRACT(
  file => TO_FILE('@BBC_OS.SANDBOX.DOCS', 'sample_inspection_cert.pdf'),
  responseFormat => {
    'certificate_no': 'What is the certificate number?',
    'lot': 'What is the lot id?',
    'inspected_at': 'What is the inspection date and time?',
    'pulp_temp_c': 'What is the pulp temperature at loading in degrees C?',
    'setpoint_c': 'What is the reefer setpoint per BOL in degrees C?',
    'decay_pct': 'What is the decay percentage?'
  }
) AS extracted;

-- -----------------------------------------------------------------------------
-- S4. Snowpark Python runtime + packages (numpy, scipy.optimize.milp, jsonschema)
--     PASS: CALL returns versions and milp_x = [0, 1].
--     If RUNTIME_VERSION 3.12 is rejected, retry with 3.11 and record which works.
-- -----------------------------------------------------------------------------
SELECT package_name, MAX(version) AS latest
FROM BBC_OS.INFORMATION_SCHEMA.PACKAGES
WHERE language = 'python' AND package_name IN ('numpy', 'scipy', 'jsonschema', 'snowflake-snowpark-python')
GROUP BY package_name;

CREATE OR REPLACE PROCEDURE P_PYCHECK()
  RETURNS VARIANT
  LANGUAGE PYTHON
  RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python', 'numpy', 'scipy', 'jsonschema')
  HANDLER = 'run'
AS $$
import sys
import numpy as np, scipy, jsonschema
from scipy.optimize import milp, LinearConstraint, Bounds

def run(session):
    # maximise x0 + 2*x1 subject to x0 + x1 <= 1, binary  ->  x = [0, 1]
    res = milp(c=np.array([-1.0, -2.0]),
               constraints=LinearConstraint(np.array([[1.0, 1.0]]), ub=[1.0]),
               integrality=np.ones(2), bounds=Bounds(0, 1))
    return {"python": sys.version.split()[0], "numpy": np.__version__,
            "scipy": scipy.__version__, "jsonschema": jsonschema.__version__,
            "milp_x": [round(v) for v in res.x]}
$$;
CALL P_PYCHECK();

-- -----------------------------------------------------------------------------
-- S5. Python UDF returning VECTOR(FLOAT, n)
--     PASS: both statements run.  FALLBACK: RETURNS ARRAY, then ::VECTOR(FLOAT, 3).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION F_VEC(x ARRAY)
  RETURNS VECTOR(FLOAT, 3)
  LANGUAGE PYTHON RUNTIME_VERSION = '3.12' HANDLER = 'f'
AS $$
def f(x):
    return [float(v) for v in x]
$$;
SELECT F_VEC([1, 2, 3]) AS v,
       VECTOR_L2_DISTANCE(F_VEC([1, 2, 3]), [1, 2, 4]::VECTOR(FLOAT, 3)) AS d;  -- expect d = 1

-- -----------------------------------------------------------------------------
-- S6. Time Travel retention on BBC_OS
--     PASS: value = 30.  FALLBACK: 1 (replay is unaffected; note it).
-- -----------------------------------------------------------------------------
SHOW PARAMETERS LIKE 'DATA_RETENTION_TIME_IN_DAYS' IN DATABASE BBC_OS;

-- -----------------------------------------------------------------------------
-- S7. Which Cortex models answer on this account (cross-region is enabled)?
--     PASS: at least one Claude model for agents + a second model family for the Auditor.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE P_MODELS()
  RETURNS VARIANT
  LANGUAGE PYTHON RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python')
  HANDLER = 'run'
AS $$
MODELS = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5",
          "claude-4-sonnet", "claude-3-7-sonnet", "openai-gpt-5", "llama4-maverick",
          "mistral-large2", "deepseek-r1"]

def run(session):
    out = {}
    for m in MODELS:
        try:
            r = session.sql("SELECT AI_COMPLETE(?, 'Reply with the single word OK') AS r",
                            params=[m]).collect()[0]["R"]
            out[m] = {"ok": True, "reply": str(r)[:40]}
        except Exception as e:
            out[m] = {"ok": False, "error": str(e)[:160]}
    return out
$$;
CALL P_MODELS();

-- -----------------------------------------------------------------------------
-- S8 + S9. Cortex Agent with a generic tool bound to a procedure; JSON-string
--     arguments; every parameter required; tool runs under the caller's DEFAULT role.
--     After creating it here, tell Claude: it runs snowflake/spikes/s8_agent_rest.py
--     locally with BBC_AGENT_PAT (REST :run + SSE) and records the result.
--     Use the model that passed S7 if claude-sonnet-4-6 did not.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE ECHO_JSON(P_RUN_ID STRING, P_PAYLOAD STRING)
  RETURNS VARIANT
  LANGUAGE PYTHON RUNTIME_VERSION = '3.12'
  PACKAGES = ('snowflake-snowpark-python')
  HANDLER = 'run'
  EXECUTE AS OWNER
AS $$
import json

def run(session, p_run_id, p_payload):
    data = json.loads(p_payload)
    caller = session.sql("SELECT CURRENT_USER() AS u").collect()[0]["U"]
    return {"status": "OK", "run_id": p_run_id, "decoded_type": type(data).__name__,
            "keys": sorted(data) if isinstance(data, dict) else None, "caller": caller}
$$;

CREATE OR REPLACE PROCEDURE NOT_GRANTED()
  RETURNS STRING LANGUAGE SQL EXECUTE AS OWNER
AS $$ BEGIN RETURN 'should not be reachable by BBC_AGENT_RUNTIME'; END; $$;

GRANT USAGE ON SCHEMA BBC_OS.SANDBOX TO ROLE BBC_AGENT_RUNTIME;
GRANT USAGE ON PROCEDURE ECHO_JSON(STRING, STRING) TO ROLE BBC_AGENT_RUNTIME;

CREATE OR REPLACE AGENT SPIKE_AGENT
  COMMENT = 'WP1 spike S8/S9 - drop after recording results'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6
orchestration:
  budget:
    seconds: 60
    tokens: 8000
instructions:
  orchestration: >
    When asked to echo, call ECHO_JSON exactly once. Pass P_RUN_ID as the run id you
    are given, and P_PAYLOAD as the given object encoded as a JSON string.
    When asked to run the restricted tool, call NOT_GRANTED.
  response: "Reply with the tool result status, or the error you received."
tools:
  - tool_spec:
      type: generic
      name: ECHO_JSON
      description: "Echo a payload. P_PAYLOAD must be a JSON-encoded string."
      input_schema:
        type: object
        properties:
          P_RUN_ID:
            type: string
            description: "Run id"
          P_PAYLOAD:
            type: string
            description: "JSON-encoded object, passed as a string"
        required: ["P_RUN_ID", "P_PAYLOAD"]
  - tool_spec:
      type: generic
      name: NOT_GRANTED
      description: "A restricted tool the runtime role has no USAGE on."
      input_schema:
        type: object
        properties: {}
tool_resources:
  ECHO_JSON:
    identifier: "BBC_OS.SANDBOX.ECHO_JSON"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_APP_WH
  NOT_GRANTED:
    identifier: "BBC_OS.SANDBOX.NOT_GRANTED"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_APP_WH
$$;
GRANT USAGE ON AGENT SPIKE_AGENT TO ROLE BBC_AGENT_RUNTIME;

-- SQL fallback path (run as the builder, for comparison):
SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(
  'BBC_OS.SANDBOX.SPIKE_AGENT',
  $${"messages":[{"role":"user","content":[{"type":"text","text":"Run id RUN-SQL-1. Echo {\"case_id\":\"C-1\",\"lots\":[\"L-1\"]}"}]}]}$$,
  TRUE) AS resp;

-- -----------------------------------------------------------------------------
-- S10. Single-row UPDATE lock serializes concurrent appenders (Claude runs this
--      from two local sessions with snowflake/spikes/s10_lock.py). Setup only:
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TABLE T_LOCK (id INT, n INT);
INSERT INTO T_LOCK VALUES (1, 0);
CREATE OR REPLACE TABLE T_SEQ (session_tag STRING, n INT, committed_at TIMESTAMP_TZ);

-- -----------------------------------------------------------------------------
-- Cleanup (after ADR-0002 is filled in)
-- -----------------------------------------------------------------------------
-- ALTER TASK BBC_OS.SANDBOX.TK_TRIGGERED SUSPEND;
-- DROP AGENT IF EXISTS BBC_OS.SANDBOX.SPIKE_AGENT;
-- DROP SCHEMA IF EXISTS BBC_OS.SANDBOX CASCADE;
