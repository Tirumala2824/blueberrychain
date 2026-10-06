# ADR-0009: Persona read access for Cortex Analyst

- **Status:** Proposed (needs CoCo to apply and the owner to accept)
- **Date:** 2026-10-06
- **Depends on:** ADR-0003, ADR-0008; `snowflake/modules/70_semantic_view.sql`

## Context
- The control tower's console answers metric questions (`? which lots are below 8 days`) with Cortex Analyst over `BBC_OS.SEM.EXCURSION_RECOVERY`.
- The generated SQL runs **as the signed-in person**, so their role's grants are the real control.
- **Today no persona role can use Analyst.**
  - None has USAGE on SEM, OPS or REF, nor SELECT on the semantic view or its base objects (`00_account.sql`, `70_semantic_view.sql`).
  - None holds the Cortex Analyst database role.
- `snowflake/tests/05_case_store.sql` fails if any role other than the auditor gets privileges on DECISION tables. That keeps persona reads of decisions behind `GET_CASE_VIEW` and `V_CASE_INBOX`.

## Decision (proposed)
- **A read-only database role, `BBC_OS.ANALYST_READ`,** granted to `BBC_QUALITY_MGR`, `BBC_SALES_MGR`, `BBC_FINANCE_MGR`, `BBC_AUDITOR` and `BBC_GOVERNANCE_ADMIN`. It holds:
  - USAGE on database `BBC_OS` and schemas SEM, OPS and REF;
  - SELECT on `SEM.EXCURSION_RECOVERY` and the SEM views it reads (`CURRENT_PRODUCTS`, `CURRENT_PARTIES`, `CURRENT_SITES`, `INVENTORY_POSITIONS`);
  - SELECT on the OPS Dynamic Tables those views read.
  - No DECISION, EVIDENCE, LEDGER or GOV objects, and no DML.
- **Cortex access:** grant `SNOWFLAKE.CORTEX_ANALYST_USER` (or `CORTEX_USER`) to the same persona roles.
- **v1 scope is the live layer only:** shelf life, compliance, custody exposure, available-to-promise and order value. Decision metrics (rule vs agent share, value protected, time to decision) need decision entities in the semantic view. They should be exposed through API-owned secure views that keep the DECISION grant boundary, as a separate change.
- **Defense in depth stays in the app.** `checkAnalystSql` accepts one read-only `SELECT`/`WITH` statement, and each statement runs with a 30-second timeout, a 1,000-row cap and a `QUERY_TAG`.

## Consequences
- Until this is applied, `ask` in live mode reports that `ANALYST_MESSAGE` isn't available yet. Fixture mode answers from recorded tapes.
- Every analyst query is attributable in the query history, through the person's own user and `bbc-ct:analyst:*` tags.

## Alternatives considered
- **A shared analyst service user:** rejected, because questions would no longer be attributable to the person.
- **Granting DECISION SELECT to persona roles:** rejected, because it breaks the read-model boundary that `05_case_store.sql` enforces.
