# ADR-0008: Application layer (control tower, console, engine)

- **Status:** Accepted
- **Date:** 2026-10-06
- **Depends on:** ADR-0003 (identity), ADR-0004 (engine and SQL access); `docs/frontend-spec.md`

## Context
- **The design record** puts the frontend, the server-side API layer, sessions, the engine and the outbound integrations in application code. It puts governance, the case state machine, every number and every enforcement point in Snowflake (Phase 7).
- **The Snowflake interfaces the app needs don't exist yet.**
  - Not in the account, and not in the DDL: the case view, the inbox, approvals, proof, work leases and agent runs, all due in WP6b, WP7a, WP7b and WP8a.
  - The design left the case view's shape to be designed with the frontend.
  - **Since then,** modules `82_stages.sql`, `83_gateway.sql` and `84_outcome_audit.sql` delivered `CLAIM_WORK`, `ADVANCE_CASE`, `EXECUTE_PLAN`, `NEXT_ACTIONS`, `ACK_MUTATION`, `DECIDE_APPROVAL`, `EMERGENCY_STOP` and `VERIFY_LEDGER`. The app calls them with their delivered signatures and validates their delivered result shapes. The persona read model (case view, inbox), replay, export, reverse and agent runs are still to come.
- **The product mustn't become a chatbot or a KPI dashboard** (Phase 2). Yet the person asked for "the conversation as a control surface for the decision system".

## Decision
**1. Contract-first read models.** The app's view of Snowflake is drafted as JSON Schemas in `contracts/schemas/api/`, with fixtures validated by both languages.
- The schemas are `case_view`, `inbox_row`, the result of every API procedure, the agent-run record and trace event, and the dispatcher's ACK (`mutation_ack`: observations only).
- Each field is a projection of existing DECISION, EVIDENCE, OPS, GOV or LEDGER columns, so CoCo can implement it without redesigning anything.
- `viewer.available_actions` is computed in Snowflake for `CURRENT_USER()`. The UI only shows or hides actions from it; the procedures still enforce every rule.

**2. One port onto Snowflake.** `packages/bbc-api` holds every SQL statement the app may run in one table (`INTERFACES`).
- That covers API procedure calls, API view reads, `SELECT CURRENT_USER()`, and the governance admin's existing `GOV.POLICY_VERSIONS` read. A test forbids anything else, including any DML.
- Every result is validated against its contract before use. On a mismatch the app fails closed.

**3. The control tower** (`apps/control-tower`, Next.js App Router) is presentation plus a framework-free server layer (`src/server`). The route handlers only forward.
- **No credentials in the browser.** The browser talks only to this server. Each signed-in person acts as their own Snowflake user, with their own PAT, read on the server for each call.
- **Sessions.** They live in server memory behind an HMAC-signed `HttpOnly; SameSite=Strict` cookie. They hold a CSRF token, pending confirmations, and console history. History is never persisted and is never decision memory.
- **Sign-in.** Without an access code, sign-in works only from loopback.

**4. One write path.** Every governed write starts as a console command; panel buttons generate the same text.
- The server re-reads the case and requires an enabled action.
- It then returns a confirm card. The card shows the person, their Snowflake user and role, the Brief hash, and the exact `CALL` with its bound values.
- Confirming redeems a 90-second, single-use, session-bound grant. The server refuses if the case's `change_token` moved since the card was issued, then runs the stored call verbatim.
- Snowflake remains the enforcement point. Its refusal is shown as-is.

**5. The console is deterministic.**
- **Grammar.** A fixed set of verbs, whose answers are structured artifacts cut from the governed case view, with template text only: `status`, `brief`, `why`, `compare`, `evidence`, `trace`, `ledger`, `exec`, `outcome`, `policy`, `approvals`, `verify`, `replay`, `export`, `approve`, `choose`, `reject`, `reverse`, `stop-dispatch`.
- **Analyst questions.** Only input starting with `ask` or `?` goes to Cortex Analyst over `SEM.EXCURSION_RECOVERY`.
  - Its SQL is checked (one read-only statement) and run as the person.
  - Only the result rows carry numbers. The card is marked "not decision evidence" and has no actions.
- **Unknown input** gets suggestions. It is never sent to a model.

**6. The lifecycle rail groups the design's 11 stages into 8.** The stages are Event, Analysis, Options, Decision, Approval, Execution, Outcome and Evidence (`packages/shared/src/cockpit.ts`). A test checks that every case state belongs to a stage. The grouping is presentation only.

**7. Fixture mode** (`BBC_API_MODE=fixture`) replays recorded tapes (`contracts/tapes/*.json`) through the same port, with no business logic.
- **What the player does:** it returns snapshots and matches recorded responses by call, persona, frame and arguments. With no match, it refuses with `FIXTURE_NO_RECORDING`.
- **Where tapes come from:** synthetic tapes are built in typed code (`packages/bbc-api/src/fixture/author`) from the contract fixtures, with real ledger hash chains. A drift test keeps them current.
- **How it is marked:** the UI shows a persistent hazard banner, and every confirm card repeats that nothing reaches Snowflake.

**8. The engine** (`packages/engine`) executes what Snowflake leases.
- **Lifecycle worker:** leases with `CLAIM_WORK`, then does what its `next` says: `ADVANCE_CASE` with the expected state, `EXECUTE_PLAN` for an approved case, or the agent Snowflake named.
- **Agent runs:** `START_AGENT_RUN`, then the Cortex Agent REST SSE call as `BBC_AGENT_SVC`, then `END_AGENT_RUN`. Runs fail closed and are never retried.
- **Dispatcher:** asks for the key's status before any resend, checks preconditions, writes once, and reads the target back. `ACK_MUTATION` gets only what it observed; Snowflake decides `VERIFIED`, `FAILED` or `ABORTED_PRECONDITION`. An unknown outcome (a timeout) is not acknowledged: the dispatcher asks the target again on its next tick. It is serialized per target entity.
- **Live traces:** served on a loopback, token-protected SSE relay. The control tower proxies it only for runs on cases Snowflake lets the person see.

## Consequences
- **The app works against tapes today.**
  - Each panel goes live when CoCo delivers its interface. Until then, live mode shows "not available yet, delivered by WPx", taken from `INTERFACES`.
  - The interface requests for the briefs are in `docs/frontend-spec.md`.
- **Analyst needs grants** that don't exist (ADR-0009).
- **The handlers map the gateway's ids to each target's keys** with the ingest connectors' own identities (the SAP key map, the order line id format). Some actions have no outbound handler yet. Both are in `contracts/apis/dispatch-target-states.md`.
- **Next.js needs a browser-safe entry point** into the shared package (`@blueberrychain/shared/cockpit`), because the main entry loads contracts with `node:fs`.
- **Sessions and grants live in one server process.** Before production, move them to a shared store, and replace persona PATs with SSO (ADR-0003).

## Alternatives considered
- **A natural-language console**, with an LLM mapping text to commands: rejected for v1. It adds a model to the write path's front door, and the grammar already covers every governed action.
- **A browser that calls Snowflake directly** (OAuth in the browser): rejected. Credentials would reach the browser, and the UI couldn't be held to the contracts.
- **Business logic in fixture mode**, a fake state machine for realistic demos: rejected. Fixture behaviour could then drift from Snowflake's, and become the thing people trust.
