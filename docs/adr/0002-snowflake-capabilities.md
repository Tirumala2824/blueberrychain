# ADR-0002: Snowflake capability spikes (WP1)

- **Status:** Accepted (results recorded 2026-10-06).
- **Date:** 2026-10-06
- **Depends on:** `docs/coco-briefs/WP1-foundation-spikes.md`, `snowflake/spikes/*`

## Context
- Several design elements depend on features whose behavior on this trial account (AWS ap-south-1, cross-region Cortex enabled) has to be proven, not assumed.
- Each spike below names the design element that depends on it and the fallback that keeps the design intact if it fails.

## Results
| Spike | Design element that depends on it | PASS condition | Result | Evidence | Decision |
|---|---|---|---|---|---|
| S1 ASOF JOIN in an incremental DT | `OPS.TELEMETRY_ASSIGNED` (reading → lot → custody holder) | `refresh_mode = INCREMENTAL`, correct lots | **FALLBACK** | `CREATE DYNAMIC TABLE ... REFRESH_MODE = INCREMENTAL` with ASOF JOIN is rejected: *"Change tracking is not supported on queries with joins of type '[ASOF_JOIN]'"* (091926). S1b interval join: `refresh_mode = INCREMENTAL`, lots L-1 / L-2 correct | Interval join: assignments and custody events become `[from, to)` intervals, then a range join (`62_ops_thermal.sql`) |
| S2 Stream on a DT + triggered task | Case detection (`OPEN_CASES`), document extraction | Task fires within ~2 min | **PASS** | Stream on the S1b DT; triggered task (no schedule) wrote `T_TASK_LOG` 30 s after the insert (05:38:34 → 05:39:04) | Triggered task as designed (`81_detection.sql`) |
| S3 Directory stream + AI_EXTRACT on a PDF | Evidence pipeline (`EXTRACT_NEW_DOCUMENTS`) | Correct certificate number, lot, temperatures | **PASS** | `snow sql PUT` works from the workstation. Stream row `sample_inspection_cert.pdf:INSERT`. AI_EXTRACT: `SFI-2026-044812`, `L-2291`, pulp `1.0`, setpoint `0.5`, decay `0.5`, `2026-10-03 06:40 PDT` | AI_EXTRACT on the file directly |
| S4 Python runtime + numpy / scipy `milp` / jsonschema | `bbc_engine` in procedures (solver, Monte Carlo), validators | Versions + `milp_x = [0, 1]` | **PASS** | Python 3.12.13, numpy 2.5.3, scipy 1.18.1, jsonschema 4.26.0, `milp_x = [0, 1]` | Runtime 3.12 |
| S5 Python UDF returning VECTOR | `MEMORY.FEATURE_VECTOR`, precedent retrieval | L2 distance = 1 | **PASS** | `F_VEC([1,2,3])` = `[1,2,3]`, `VECTOR_L2_DISTANCE(..., [1,2,4])` = 1 | `RETURNS VECTOR(FLOAT, n)` |
| S6 30-day Time Travel | Operational recovery; zero-copy-clone tamper demo (replay doesn't depend on it) | 30 | **PASS** | `00_foundation.sql` retention test PASS (30) | 30 days |
| S7 Cortex models available | Agent models; Auditor independence (`GOV.MODEL_REGISTRY`) | ≥ 1 Claude + a second family | **PASS (Auditor model changed)** | OK: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`, `openai-gpt-5`. Not available: `claude-4-sonnet` (legacy), `claude-3-7-sonnet`, `llama4-maverick`, `mistral-large2`, `deepseek-r1` | Authoring agents `claude-sonnet-4-6`; Auditor `openai-gpt-5` (policy v1 `model_registry`) |
| S8 Agent REST with a PAT + SSE | Engine `cortex-agent` provider (live trace) | 200 + `text/event-stream` | **PASS** | `s8_agent_rest.py` as `BBC_AGENT_SVC` (PAT, no network policy): `text/event-stream`, events `response.status / thinking.delta / tool_use / tool_result / text.delta / response / done`. SQL path `DATA_AGENT_RUN` also works | REST `:run` + SSE primary; `DATA_AGENT_RUN` fallback |
| S9 Generic tool: JSON-string args, required params, default-role execution, ungranted tool refused | All 18 agent tools; case-scoped capability. Also separation of duties in `API.ACTIVATE_POLICY` and `API.DECIDE_APPROVAL`, which read `CURRENT_USER()` inside owner's-rights procedures | Payload decoded; caller = `BBC_AGENT_SVC`; NOT_GRANTED refused | **PASS** | ECHO_JSON: `decoded_type = dict`, keys `[case_id, lots]`, `caller = BBC_AGENT_SVC`. NOT_GRANTED: tool_result `status = error`, *"Unknown user-defined function BBC_OS.SANDBOX.NOT_GRANTED"*. Policy activation as the drafter → DENIED; as `BBC_DEMO_GOVADMIN` → OK | As designed |
| S10 Single-row UPDATE lock serializes writers | `LEDGER.HEAD`, `DECISION.GATEWAY_LOCK` | n = 1, 2; ~8 s apart | **PASS** | B: n = 1 at 06:06:54.2; A: n = 2 at 06:07:04.0 | As designed |

## Decision
- Every spike passes except S1, which takes its documented fallback: the OPS thermal Dynamic Tables use interval range joins instead of ASOF JOIN, so they stay incremental.
- The Auditor runs `openai-gpt-5` (a different model family from the Claude authoring agents), recorded in policy v1's `model_registry`.

## Consequences
- `snowflake/modules/62_ops_thermal.sql` builds `DEVICE_ASSIGNMENT_INTERVALS` and `LOT_CUSTODY_INTERVALS` and range-joins them (WP3).
- PATs authenticate without a network policy (`NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED`), so no network policy is created.
- Two platform details found while deploying, fixed in code: procedure DDL needs `COMMENT` before `EXECUTE AS`, and Snowpark binds Python `None` as the string `'None'` (handled by `bbc_toolkit.snow.bind_nulls`). A VARIANT procedure parameter needs `PARSE_JSON(?)` in the CALL; Snowflake does not cast VARCHAR to VARIANT.
