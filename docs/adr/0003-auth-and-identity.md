# ADR-0003: Authentication and identity

- **Status:** Accepted, pending S8 / S9 confirming PAT behavior.
- **Date:** 2026-10-06
- **Depends on:** `snowflake/modules/00_account.sql`, `00b_tokens.sql`; ADR-0002 S8 / S9

## Context
- Governance rests on **who** did something: approvals must come from a real, distinct person holding the required role, and agents must never act with more than their tools allow.
- Cortex Agents take their permissions from the *caller's default role*.
- The trial account has no SPCS, so the app runs locally and needs non-interactive credentials.

## Decision
- **One Snowflake user per runtime identity**, each with **exactly one** runtime role as its default role and `BBC_APP_WH` as its default warehouse:

| User | Role | Purpose |
|---|---|---|
| `BBC_INGEST_SVC` | `BBC_INGEST` | Connectors |
| `BBC_ENGINE_SVC` | `BBC_ENGINE` | Engine worker and dispatcher |
| `BBC_AGENT_SVC` | `BBC_AGENT_RUNTIME` | Agent invocation only, so agents run with minimal rights |
| `BBC_DEMO_QUALITY` / `SALES` / `FINANCE` / `AUDITOR` / `GOVADMIN` | Persona roles | Demo approvers |

- **Programmatic access tokens (PATs) only.**
  - The authentication policy `BBC_OS.GOV.BBC_PAT_ONLY` allows only PAT authentication.
  - Each PAT is **role-restricted** to that user's runtime role, expires after 30 days, and is rotated with `ROTATE PROGRAMMATIC ACCESS TOKEN`.
  - On this trial, no network policy is required (`NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED`).
- **Secrets live only in the local `.env`** (gitignored).
  - They're created in Snowsight or the `snow` CLI, **never in an AI chat session**.
  - The browser never receives a Snowflake credential: the UI's server-side API layer holds the persona PATs (Day 14).
- **Approvals are attributed to `CURRENT_USER()`** inside `API.DECIDE_APPROVAL`.
  - Separation of duties (proposer ≠ approver; dual approval needs two different *users*) is checked on user identity, not role membership.
  - The **"Ops" approver** in the autonomy thresholds maps to `BBC_QUALITY_MGR` (quality & operations manager).
- **Builders** (the CoCo session user) assume `BBC_OWNER` to create objects. `BBC_OWNER` is never used by the app or the agents at runtime.

## Consequences
- **Before production:**
  - add a network policy;
  - shorten token expiry;
  - move tokens to a secrets manager;
  - replace persona PATs with SSO / OAuth for real people.
- **Simulated backfill** (Day 13) performs scripted approvals as persona users, labelled `provenance = SIMULATION_BACKFILL`.

## Alternatives considered
- **Key-pair auth:** viable, but heavier to set up for demo personas.
- **Password auth:** rejected for service users.
- **One shared app user with role switching:** rejected. It would make every approval look like the same person and defeat separation of duties.
