# ADR-0007: Naming conventions (and the CASE → DECISION rename)

- **Status:** Accepted
- **Date:** 2026-10-06

## Context
- The design documents call the lifecycle schema `CASE`, e.g. `CASE.CASES` and `CASE.MUTATE`.
- `CASE` is a **reserved word** in Snowflake SQL, so `CREATE SCHEMA BBC_OS.CASE` fails without quoting, and quoting it everywhere invites bugs.

## Decision
- **The lifecycle schema is `DECISION`.** Every `CASE.<object>` in the design documents is `DECISION.<object>` in the implementation: `DECISION.CASES`, `DECISION.OPTIONS`, `DECISION.MUTATE`, `DECISION.MUTATIONS`, `DECISION.GATEWAY_LOCK`, and so on. Nothing else changes.
- **Conventions:**
  - Unquoted UPPER_SNAKE identifiers.
  - Schemas are short nouns.
  - Procedures are verbs (`OPEN_CASES`, `BUILD_ASSESSMENT`, `DECIDE_APPROVAL`).
  - Views use a `V_` prefix.
  - Dynamic Tables have no prefix: they are named for what they hold.
  - Tool procedures are named after the tool contract (`GET_CASE_CONTEXT`, `SUBMIT_RECOMMENDATION`).
  - Tasks use `T_`, streams `S_`.
  - Money columns end in `_USD` (`NUMBER(14,2)`), prices in `_USD_PER_KG` (`NUMBER(10,4)`), mass in `_KG` (`NUMBER(14,3)`), temperatures in `_C`, durations in `_MIN` / `_H` / `_DAYS`.
  - Timestamps are `TIMESTAMP_TZ` and end in `_AT` / `_TS`.
- **Avoid other reserved words as identifiers** (CASE, ORDER, GROUP, TABLE, USER, CURRENT_*, …). For example, order lines live in `OPS.ORDER_LINES`, not `ORDER`.

## Consequences
- Readers of the design documents apply the rename mentally. `docs/design/implementation-plan.md` carries an errata note pointing here.
