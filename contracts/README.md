# Contracts

**The single source of truth for every boundary in BlueberryChain OS.**

The files are language-neutral: JSON Schema 2020-12, test vectors and API specs.
- **Python** (`bbc_toolkit.contracts`) validates against them, and so do the Snowflake procedures, which ship a bundled copy.
- **TypeScript** (`@blueberrychain/shared`) generates types from them and validates them with ajv.

| Path | What it defines |
|---|---|
| `schemas/common.json` | Shared IDs, units, frozen enums (dispositions, causes, action types, case states…), the self-describing `value` object, `untrusted_text` |
| `schemas/evidence_pack.json` | Sealed snapshot of every fact a decision used |
| `schemas/option.json` | One candidate bundle + its deterministic outcome (never aggregated across options) |
| `schemas/brief.json` | The Decision Brief: the six questions; approvals bind to `brief_hash` |
| `schemas/finding.json`, `recommendation.json`, `claim_recommendation.json`, `audit_verdict.json` | What each agent may submit (payloads only; the server adds identity and checks business rules) |
| `schemas/mutation_intent.json`, `mutation_record.json` | The mutation gateway's input and its nine-step governed record |
| `schemas/tool_envelope.json`, `schemas/tools/*.json` | The agent tool response envelope and the 18 tool inputs |
| `tool_registry.json` | Tool → category, allowed agents, write behavior, procedure |
| `schemas/raw/telemetry_reading.json`, `schemas/raw/business_event.json`, `schemas/raw/payloads/*.json` | What connectors write into RAW |
| `vectors/` | Cross-language test vectors (canonical hash, idempotency keys) |
| `fixtures/` | Valid / invalid instances for every schema (see `fixtures/README.md`) |
| `apis/` | Mock S/4HANA (OData) and mock TMS (OpenAPI) contracts |

## Idempotency keys (RAW)
The Snowflake sink MERGEs on `idempotency_key`, so connector retries never duplicate rows. Keys are the canonical hash (see `bbc_toolkit/ledger.py`) of:

| Row | Hashed object |
|---|---|
| Telemetry | `{"kind":"TELEMETRY","device_id","reading_ts"}` |
| Business event | `{"kind":"BUSINESS_EVENT","source_system","entity_type","external_id","version": event_ts}` |

**Timestamps are normalized to UTC** (`YYYY-MM-DDTHH:MM:SS.ffffffZ`) before hashing. Every implementation must reproduce `vectors/idempotency.json`.

## Changing a contract
1. Edit the schema, then update or add fixtures, valid **and** invalid.
2. Regenerate the TypeScript types: `corepack pnpm --filter @blueberrychain/shared generate`.
3. Run `uv run pytest` and `corepack pnpm -r test`. The drift test fails if the generated types are stale.
4. **Breaking change** (a removed field, or a narrowed enum or range)? Bump the affected version and record an ADR.
