# ADR-0001: Repository layout and tooling

- **Status:** Accepted. The Python runtime pin is provisional until spike S4.
- **Date:** 2026-10-06
- **Depends on:** plan task 1.1; ADR-0002 S4

## Context
- The platform is open source and spans TypeScript (connectors, engine, UI, mocks) and Python (simulator, decision engine, Snowflake procedures, CLI).
- Any machine must be able to set it up with no global installs beyond Node and uv.

## Decision
- **One monorepo, licensed Apache-2.0.**
  - `contracts/`: language-neutral JSON Schemas and API specs, the single source of truth.
  - `snowflake/`: DDL modules, spikes and SQL tests.
  - `packages/`, `apps/`: TypeScript.
  - `python/`: Python.
  - `docs/`: documentation.
- **Node:**
  - pnpm workspaces, pinned through `"packageManager": "pnpm@10.34.6"` and run via **corepack** (`corepack pnpm …`), so there's no global pnpm install;
  - Node ≥ 22 (developed on 24);
  - strict TypeScript (`tsconfig.base.json`);
  - vitest.
  - Only `esbuild` may run install scripts (`onlyBuiltDependencies`).
- **Python:**
  - a **uv** workspace (`pyproject.toml` at the root) with members `bbc-engine`, `bbc-toolkit` and `blueberrychain` (the `bbc` CLI);
  - hatchling builds;
  - ruff (rule set pinned in `pyproject.toml`) and pytest.
- **Python version:**
  - Local development uses **3.12** (`.python-version`).
  - Code must stay **3.11-compatible** (`ruff target-version = py311`), because `bbc_engine` and `bbc_toolkit` also run inside Snowflake Python procedures.
  - Spike S4 confirms the Snowpark runtime. If 3.12 isn't available there, procedures use 3.11 and nothing else changes.
- **Common commands:** `corepack pnpm -r build`, `corepack pnpm -r test`, `uv run pytest`, `uv run ruff check python`, `uv run bbc test sql`.

## Consequences
- Contracts are written once and consumed by both languages: types are generated for TypeScript, and JSON Schema validation is used in Python.
- Engine code can't use Python 3.12-only syntax.

## Alternatives considered
- **Separate repos per language:** rejected. It splits the contracts and slows cross-cutting changes.
- **npm workspaces:** rejected. pnpm is faster, stricter about phantom dependencies, and has a better workspace filter.
