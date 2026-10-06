# ADR-0002: Snowflake capability spikes (WP1)

- **Status:** Proposed. **Results pending** (fill in from WP1).
- **Date:** 2026-10-06
- **Depends on:** `docs/coco-briefs/WP1-foundation-spikes.md`, `snowflake/spikes/*`

## Context
- Several design elements depend on features whose behavior on this trial account (AWS ap-south-1, cross-region Cortex enabled) has to be proven, not assumed.
- Each spike below names the design element that depends on it and the fallback that keeps the design intact if it fails.

## Results
| Spike | Design element that depends on it | PASS condition | Result | Evidence | Decision |
|---|---|---|---|---|---|
| S1 ASOF JOIN in an incremental DT | `OPS.TELEMETRY_ASSIGNED` (reading → lot → custody holder) | `refresh_mode = INCREMENTAL`, correct lots | | | |
| S2 Stream on a DT + triggered task | Case detection (`OPEN_CASES`), document extraction | Task fires within ~2 min | | | |
| S3 Directory stream + AI_EXTRACT on a PDF | Evidence pipeline (`EXTRACT_NEW_DOCUMENTS`) | Correct certificate number, lot, temperatures | | | |
| S4 Python runtime + numpy / scipy `milp` / jsonschema | `bbc_engine` in procedures (solver, Monte Carlo), validators | Versions + `milp_x = [0, 1]` | | | |
| S5 Python UDF returning VECTOR | `MEMORY.FEATURE_VECTOR`, precedent retrieval | L2 distance = 1 | | | |
| S6 30-day Time Travel | Operational recovery; zero-copy-clone tamper demo (replay doesn't depend on it) | 30 | | | |
| S7 Cortex models available | Agent models; Auditor independence (`GOV.MODEL_REGISTRY`) | ≥ 1 Claude + a second family | | | |
| S8 Agent REST with a PAT + SSE | Engine `cortex-agent` provider (live trace) | 200 + `text/event-stream` | | | |
| S9 Generic tool: JSON-string args, required params, default-role execution, ungranted tool refused | All 18 agent tools; case-scoped capability | Payload decoded; caller = `BBC_AGENT_SVC`; NOT_GRANTED refused | | | |
| S10 Single-row UPDATE lock serializes writers | `LEDGER.HEAD`, `DECISION.GATEWAY_LOCK` | n = 1, 2; ~8 s apart | | | |

## Decision
To be completed from the results. For each spike: PASS → the design stands; FALLBACK → name the fallback and the tasks it changes.

## Consequences
To be completed.
