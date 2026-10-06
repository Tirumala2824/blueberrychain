# BlueberryChain OS

**Governed excursion value recovery for perishable cold chains, on Snowflake.**

> *"When a shipment breaks the cold chain, how much of its value can we still save, and who pays for the rest?"*

**What it does:**
- **Detects** temperature excursions from live telemetry, with no human prompt.
- **Evaluates** every recovery option against "do nothing", using deterministic shelf-life, logistics and contract models.
- **Escalates** to AI agents *only* when judgment is genuinely needed.
- **Governs** every action: decision rights by role, autonomy levels, separation of duties.
- **Executes** through a single gateway into the systems of record (SAP S/4HANA, the carrier TMS).
- **Proves** every decision with a hash-chained ledger and replayable evidence.

The lifecycle at the core of the product:

```
EVENT → DETECTION → UNDERSTANDING → OPTIONS → EVALUATION → RECOMMENDATION
      → GOVERNANCE → APPROVAL → EXECUTION → OUTCOME → AUDIT
```

## 🚀 Live Demo & Hackathon Evaluation

The BlueberryChain Control Tower and Deterministic Decision Engine are deployed live on Google Cloud Run with automated CI/CD from the `dev` branch.

| Component | Environment | URL |
|---|---|---|
| **Control Tower (Cockpit UI)** | Production | [blueberrychain-control-tower](https://blueberrychain-control-tower-1061285537090.europe-west1.run.app/) |
| **Control Tower (Cockpit UI)** | Dev | [blueberrychain-control-tower-dev](https://blueberrychain-control-tower-dev-1061285537090.europe-west1.run.app/) |
| **Decision Engine API** | Production | [blueberrychain-engine-api/healthz](https://blueberrychain-engine-api-1061285537090.europe-west1.run.app/healthz) |
| **Decision Engine API** | Dev | [blueberrychain-engine-api-dev/healthz](https://blueberrychain-engine-api-dev-1061285537090.europe-west1.run.app/healthz) |

### Hackathon Evaluation Access Code
When opening the Control Tower UI, enter the following Access Code to unlock the persona switcher:

```
Access Code: e62d34cee74df5ba3edeccb4
```

### Evaluation Guide
1. Open the [Live Control Tower](https://blueberrychain-control-tower-1061285537090.europe-west1.run.app/).
2. Enter the **Access Code** above.
3. Select any governed persona role to evaluate:
   - **Quality & Operations Manager** (`BBC_QUALITY_MGR`): Review live excursion telemetry, inspect sensor pulp drift, and evaluate shelf-life recovery options.
   - **Sales Manager** (`BBC_SALES_MGR`): Assess customer delivery commitments, salvage market valuations, and order reassignment.
   - **Finance Manager** (`BBC_FINANCE_MGR`): Review downside risk, carrier claim recovery likelihood, and net financial impacts.
   - **Auditor** (`BBC_AUDITOR`): Verify cryptographic SHA-256 hash chains across the immutable decision ledger and inspect evidence packs.
   - **Governance Admin** (`BBC_GOVERNANCE_ADMIN`): Inspect active policy rules, autonomy thresholds, and emergency stops.

## Status
**Rebuild in progress, Day 1 of 18.** See the [implementation plan](docs/design/implementation-plan.md).

| Milestone | Day | Scope |
|---|---|---|
| M1 | 8 | Full lifecycle end-to-end, rule-decided |
| M2 | 11 | Agent-escalated path |
| M3 | 12 | Claims (D2 settlement) |
| M4 | 13 | Decision memory |
| M5 | 16 | Control-tower UI |

## Repository layout
```
contracts/   JSON Schemas + API specs - the single source of truth for both languages
snowflake/   DDL modules, capability spikes, SQL assertion tests
packages/    TypeScript: shared types, connector SDK + connectors, engine, agent specs
apps/        mock S/4HANA, mock TMS, control-tower UI
python/      bbc_engine (decision maths), bbc_toolkit (contracts, ledger, tools), blueberrychain (bbc CLI, simulator, evals)
docs/        ADRs, CoCo briefs, demo scenarios, design record
```

## Developer setup
**Prerequisites:**
- Node ≥ 22 (pnpm comes through corepack; no global install);
- [uv](https://docs.astral.sh/uv/);
- the Snowflake CLI (`snow`) with a named connection.

```bash
corepack pnpm install          # Node workspace
corepack pnpm -r build
corepack pnpm -r test
uv sync                        # Python workspace (Python 3.12, see ADR-0001)
uv run pytest
uv run ruff check python
uv run bbc test sql            # Snowflake assertion tests (needs the BBC_OS foundation)
```

**Snowflake objects** are built from the [CoCo briefs](docs/coco-briefs/README.md) in Cortex Code. Credentials go in a local `.env` (copy `.env.example`; never commit it).

## Key decisions
| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-repo-and-tooling.md) | Repo and tooling |
| [0002](docs/adr/0002-snowflake-capabilities.md) | Snowflake capability spikes |
| [0003](docs/adr/0003-auth-and-identity.md) | Authentication and identity |
| [0004](docs/adr/0004-engine-and-drivers.md) | Engine and drivers |
| [0005](docs/adr/0005-mock-contracts.md) | Mock SAP / TMS |
| [0006](docs/adr/0006-simulator.md) | Simulator |
| [0007](docs/adr/0007-naming.md) | Naming |

## License
[Apache-2.0](LICENSE)
