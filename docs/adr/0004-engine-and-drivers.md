# ADR-0004: Engine runtime and Snowflake drivers

- **Status:** Proposed (SQL access decided on Day 3; finalize after S8)
- **Date:** 2026-10-06
- **Depends on:** ADR-0002 S8; ADR-0003

## Context
- The engine moves cases through the lifecycle, invokes agents, and dispatches governed mutations to external systems.
- It must be **stateless**, since all state lives in Snowflake, and it must stay safe to restart at any point.

## Decision
- **Runtime:** a TypeScript Node process (`packages/engine`) with two loops in one process:
  - **lifecycle worker:** `API.CLAIM_WORK` lease → `API.ADVANCE_CASE` → agent escalation when `ADVANCE_CASE` asks for it;
  - **dispatcher:** `API.NEXT_ACTIONS` over `V_DISPATCHABLE` → read before → call target with the idempotency key → read back → `API.ACK_MUTATION`.
- **SQL access (decided on Day 3): the Snowflake SQL API over HTTPS, not a driver.**
  - `SqlApiClient` in `packages/shared` sends `POST /api/v2/statements` with the identity's PAT (`Authorization: Bearer`, `X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN`) and binds every value as TEXT. The Python CLI's persona calls use the same request shape (`snowcall.sqlapi_runner`).
  - Retries reuse the request's `requestId` with `retry=true`, so Snowflake runs a statement at most once even when a response is lost. 202 responses are polled; multi-partition results are fetched in full.
  - *Why not `snowflake-sdk`:* every call the engine and connectors make is one procedure call with bind variables, so a driver adds a native dependency and connection state for nothing. PAT authentication is identical to the persona path, which is already proven, and the client is ~150 lines with unit tests.
  - Connectors authenticate as `BBC_INGEST_SVC`; the engine as `BBC_ENGINE_SVC`.
  - Connections are pooled.
  - The SQL is fixed (procedure calls with bind variables only).
- **Agents:** the Cortex Agent REST API `POST /api/v2/databases/BBC_OS/schemas/AGENT/agents/<name>:run`, called as `BBC_AGENT_SVC` with a PAT and read as **SSE**, so the UI can show a live trace. The full event trace is recorded through `API.END_AGENT_RUN`.
  - **Fallback** (if S8 fails): `SNOWFLAKE.CORTEX.DATA_AGENT_RUN` via SQL, with no live streaming.
- **Python admin and test commands** use the `snow` CLI with a named connection.
- **Crash safety:**
  - Leases expire, so another worker can pick the case up.
  - Every procedure the engine calls is idempotent.
  - The dispatcher never resends without first querying the target by idempotency key.

## Consequences
- The engine has **no direct table access**. If a procedure doesn't expose something, the engine can't do it.
- The live agent trace depends on S8. Without it, the UI shows the trace only after the run completes.

## Alternatives considered
- **Snowflake Tasks driving the entire lifecycle:** rejected. Agents, external dispatch and pluggable LLM providers need a runtime with network access. Tasks still handle detection, extraction and the deadline watchdog.
- **A Python engine:** rejected. The TypeScript connectors and UI share contracts and the runtime.
