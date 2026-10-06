# Control tower: frontend specification

- **Status:** Implemented in fixture mode; live mode waits for the interfaces below.
- **Plan tasks:** 12.6 (spec), 14–16 (frontend).
- **Decisions:** ADR-0008 (application layer), ADR-0009 (Analyst access).

The control tower is the decision cockpit for excursion value recovery. It isn't a chatbot and it isn't a KPI dashboard. Everything it shows is a governed field of a Snowflake read model, and everything it does is a governed Snowflake procedure, called as the signed-in person.

## Screens
| Path | Who | What |
|---|---|---|
| `/sign-in` | everyone | Choose who you are. Each person is a Snowflake user with its own role. In live mode, only people whose PAT is configured on the server can sign in. |
| `/inbox` | all personas | A table of open cases in Snowflake's `inbox_rank` order (decision deadline × value at risk), with filters for waiting for you, open and sealed. Columns: deadline countdown and fallback time, case and lots, lifecycle strip and state, roles awaited, value at risk, decider. |
| `/cases/{id}` | all personas | The cockpit (below). |
| `/cases/{id}/proof` | all personas (proof actions for the auditor and Finance) | The Evidence stage at full width, with the console. |
| `/policy` | governance admin (others see why it isn't shown) | The active policy, read-only: kill switches, decision rights, autonomy thresholds, action reversibility, agents and models. Also the emergency stop, through a confirm card. |

**Global shell:**
- Your Snowflake user and role in the top bar.
- In fixture mode, a hazard-striped banner with tape controls.
- A red "Dispatch is stopped" strip whenever `kill_switches.dispatch_enabled` is false.

## The cockpit
```
┌ header: case, lots, shipment, holder at onset │ D1/D2, state, awaited roles │ approval due / deadline countdown, fallback │ value at risk, policy, case clock ┐
├ rail (8 stages, numbered) ┬ stage panel (scrolls) ───────────────────────────────────────────────┬ cited evidence (drawer) ┤
├ console (transcript, confirm card, command line with autocomplete) ─────────────────────────────────────────────────────┤
```
- **The rail.** It marks each stage done, current or ahead, and follows the case as it moves unless the person is reading another stage. The 27 case states are grouped into 8 stages (`packages/shared/src/cockpit.ts`).
- **Time.** Countdowns run on the case clock: the view's `generated_at`, plus the time since it was fetched.

| Stage | Shows (read-model fields) |
|---|---|
| **Event** | `event.detection` (rule, window, threshold, policy version); `case.lots`; the case's ledger entries as a timeline, in lanes (detection, engine, agents, people, gateway) |
| **Analysis** | **Temperature chart per lot** from `analysis.thermal` (15-minute buckets). Holder bands come from `pack.custody_timeline`. Markers show breach onset, detection, pack as-of and approval. Document claims are diamonds joined to the probe reading. A table view of the readings is also provided. |
| | **Other sections:** the reefer's own state (`pack.shipment.reefer_state`); custody exposure shares (`pack.lots[].custody_exposure`); documents against sensors (`pack.documents[].claims[].consistency`). |
| | **The cause** (`analysis.findings`): hypotheses, evidence trust, the AI narrative (marked), and liability on sensors alone vs with the finding (`brief.comparison.p_liab_*`). Also the Forensics run, with a live trace while it runs. |
| **Options** | A value chart (expected NRV with its P10–P90 range against doing nothing). Ranked feasible options, each expandable to its bundle and NRV parts. Ruled-out options with their elimination codes and citations. All from `options[]`. |
| **Decision** | The decider badge (rule `R-…@v`, AI agent `NAME@spec` with its audit status, person, fallback). The recommendation and Brief hash. The **Decision Brief's six questions** (`brief.json`). For AI decisions: the auditor's verdict overlaid on `audited_text`, sentence by sentence, plus the agent's trade-off, rejected alternatives and runs. |
| **Approval** | **Your decision:** only from `viewer.available_actions`. An enabled action offers approve, choose another option or reject with a reason. A disabled one shows Snowflake's `disabled_reason`. |
| | **Also shown:** the fallback notice (`governance.fallback`); approvals with due countdown, decider and freshness; the policy evaluation (outcome, level, matched rules, reasons, dimension bands). |
| **Execution** | Plans and their steps. One card per mutation: gateway steps with timestamps, expected vs observed before and after, metric drift since the decision, actor chain, compensation links. Reverse, if offered. |
| **Outcome** | Per lot: realized vs predicted vs doing nothing re-scored ex post, value protected after the fact, and shelf-life prediction error. All from `outcome.lots`, computed in Snowflake. The claim's path (`outcome.claims`). |
| **Evidence** | Proof actions (if offered): verify the ledger, verify a tampered clone, replay the pack, export. Packs with content hashes. The ledger chain (each entry's previous hash and its own). |

**Citations.** Every `EV:…` id is a chip. Clicking it opens the cited fact in the drawer, resolved inside the case view: the pack's JSON pointer, the option, or the document claim. Ids minted by agent tools that aren't in the view say so.

## Console
- **Read:** `status`, `brief [q1..q6]`, `why OPT-…`, `compare OPT-… OPT-…`, `evidence EV:…`, `trace [RUN-…]`, `ledger [n]`, `exec [MUT-…]`, `outcome`, `policy`, `approvals`, `help`.
- **Proof:** `verify [--table DB.SCHEMA.TABLE]` (the whole ledger table, or a clone of it), `replay [PACK-…]`, `export`.
- **Decide:** `approve [APR-…] reason "…"`, `choose OPT-… [APR-…] reason "…"`, `reject [APR-…] reason "…"`, `reverse [REC-…] reason "…"`, `stop-dispatch reason "…"`. `DECIDE_APPROVAL` requires a reason for every verdict.
- **Ask:** `ask <question>` or `? <question>`, for Cortex Analyst.

**How input is handled:**
- Short ids (`why 105`) resolve only when unambiguous.
- Unknown verbs get suggestions and are never sent to a model.
- Read answers are template text over governed fields.
- Analyst answers show the SQL that ran, the rows it returned, and who it ran as. They are marked "not decision evidence".

**The write path (the only one):**
1. The command, typed or from a panel button, is sent with the case id.
2. The server re-reads the case view and requires an enabled matching `available_action`. It checks the verdict, choosable option and reason rules from that action.
3. The server returns a confirm card: summary, Snowflake user and role, case, Brief hash, the exact statement, its bound values, and deadline and fallback warnings. The card is valid for 90 seconds.
4. **Confirm and send to Snowflake.** The grant must belong to this session, be unused and unexpired, and the case's `change_token` must be unchanged. The server then runs the stored call verbatim. Snowflake's answer is shown as-is: a receipt (for `DECIDE_APPROVAL`, the approval's new status, which can be `STALE` or `EXPIRED` rather than the verdict asked for), or the refusal and its errors.

## Fixture mode
- **Settings:** `BBC_API_MODE=fixture` and `BBC_FIXTURE_TAPES=S-A,S-B,S-C`. Tapes live in `contracts/tapes/`. Nothing reaches Snowflake.
- **The tapes:**
  - **S-A:** rule-decided re-route, Sales and Quality approval, four gateway mutations, outcome.
  - **S-B:** conflicting certificate, then Forensics, Strategist and Auditor, live traces, and dual approval.
  - **S-C:** D2 claim, carrier defense, settlement, sealed.
- **Tape controls** in the banner step the frames, which plays the parts of the world: carrier responses, the engine's progress.

## Interface map
Every Snowflake interface the application layer uses (`packages/bbc-api/src/interfaces.ts`). A test fails if this table misses one.

| Interface | App path | Statement | Identity | Delivered by |
|---|---|---|---|---|
| `WHOAMI` | `POST /api/session` (sign-in check) | `SELECT CURRENT_USER(), CURRENT_ROLE()` | persona | WP1 (exists) |
| `V_CASE_INBOX` | `GET /api/inbox`, `GET /api/stream` | `SELECT * FROM BBC_OS.API.V_CASE_INBOX ORDER BY INBOX_RANK` | quality, sales, finance, auditor, govadmin | **not delivered** (requested) |
| `GET_CASE_VIEW` | `GET /api/cases/{id}`, every console command on a case | `CALL BBC_OS.API.GET_CASE_VIEW(?)` | same | **not delivered** (requested) |
| `ACTIVE_POLICY` | `GET /api/policy` | `SELECT … FROM BBC_OS.GOV.POLICY_VERSIONS WHERE STATUS = 'ACTIVE'` | govadmin | WP2 (exists) |
| `DECIDE_APPROVAL` | console `approve` / `choose` / `reject` → confirm | `CALL BBC_OS.API.DECIDE_APPROVAL(?, ?, ?, ?)`: approval id, `APPROVE` / `ALTERNATIVE` / `REJECT`, chosen option, reason | quality, sales, finance | WP7a, `83_gateway.sql` |
| `REVERSE_DECISION` | console `reverse` → confirm | `CALL BBC_OS.API.REVERSE_DECISION(?, ?)` | roles authorized for the action type | **not delivered** (WP7b) |
| `EMERGENCY_STOP` | console `stop-dispatch` → confirm | `CALL BBC_OS.API.EMERGENCY_STOP(?)` | govadmin | WP7a, `83_gateway.sql` |
| `VERIFY_LEDGER` | console `verify` | `CALL BBC_OS.API.VERIFY_LEDGER(?)`: ledger table | auditor | WP7b, `84_outcome_audit.sql` |
| `REPLAY_EVIDENCE` | console `replay` | `CALL BBC_OS.API.REPLAY_EVIDENCE(?)` | auditor | **not delivered** (WP7b) |
| `EXPORT_EVIDENCE_PACK` | console `export` | `CALL BBC_OS.API.EXPORT_EVIDENCE_PACK(?)` | auditor, finance | **not delivered** (WP7b) |
| `ANALYST_MESSAGE` | console `ask` / `?` | `POST /api/v2/cortex/analyst/message`, then the returned SELECT | persona | ADR-0009 grants |
| `CLAIM_WORK` | engine worker | `CALL BBC_OS.API.CLAIM_WORK(?, ?)`: worker id, lease seconds | BBC_ENGINE_SVC | WP6b, `82_stages.sql` |
| `ADVANCE_CASE` | engine worker | `CALL BBC_OS.API.ADVANCE_CASE(?, ?)`: case, expected state | BBC_ENGINE_SVC | WP6b, `82_stages.sql` |
| `EXECUTE_PLAN` | engine worker (`next.kind` = `ENGINE`) | `CALL BBC_OS.API.EXECUTE_PLAN(?, ?)`: case, recommendation | BBC_ENGINE_SVC | WP7a, `83_gateway.sql` |
| `START_AGENT_RUN` | engine worker | `CALL BBC_OS.API.START_AGENT_RUN(?, ?, ?, ?, ?)` | BBC_ENGINE_SVC | **not delivered** (WP8a) |
| `END_AGENT_RUN` | engine worker | `CALL BBC_OS.API.END_AGENT_RUN(?, ?)` | BBC_ENGINE_SVC | **not delivered** (WP8a) |
| `AGENT_RUN` | engine worker | `POST /api/v2/databases/BBC_OS/schemas/AGENT/agents/{agent}:run` (SSE) | BBC_AGENT_SVC | plan 10.1 (spike S8) |
| `NEXT_ACTIONS` | engine dispatcher | `CALL BBC_OS.API.NEXT_ACTIONS(?, ?, ?)`: dispatcher id, max actions, lease seconds | BBC_ENGINE_SVC | WP7a, `83_gateway.sql` |
| `ACK_MUTATION` | engine dispatcher | `CALL BBC_OS.API.ACK_MUTATION(?, ?, ?)`: mutation, attempt, `api/mutation_ack.json` | BBC_ENGINE_SVC | WP7a, `83_gateway.sql` |

**Result contracts.**
- Each interface's result is validated against `contracts/schemas/api/*.json` before the app uses it. A mismatch fails closed: nothing partial is shown.
- Refusals use `api/refusal.json`: `{status: INVALID | DENIED, errors[]}`. Errors are plain strings or `{code, message}`; some procedures add context (`case_id`, `state`, `steps`). The console shows them verbatim.
- `VERIFY_LEDGER` is a SQL procedure without a `status`: `{ok, table, entries, first_bad_seq, reason}`, or `{ok: false, table, error}` when the table can't be read.

## Requests for the CoCo briefs
Modules `82_stages.sql`, `83_gateway.sql` and `84_outcome_audit.sql` delivered the engine interfaces, `DECIDE_APPROVAL`, `EMERGENCY_STOP` and `VERIFY_LEDGER`; the app now calls them with their delivered signatures and validates their delivered result shapes. What the app still needs, none of it a redesign:

1. **The persona read model: `GET_CASE_VIEW` and `V_CASE_INBOX`.** Live mode can't show a case without them.
   - Both only project the WP6a tables. Grant them to the persona roles (managers, auditor, governance admin).
   - `GET_CASE_VIEW` returns `api/case_view.json`, or a refusal.
   - It computes `viewer.available_actions` with `CURRENT_USER()` and the user's roles, applying the same checks as `DECIDE_APPROVAL` (role held, proposer ≠ approver, one role per evaluation per person), and returns `disabled_reason` in plain words.
   - Fields to project: `change_token` (`state_version || ':' || last ledger seq`); `inbox_rank` and `awaiting_me`; `audited_text` (the exact text the audit verdict's spans index, in code points); `value_protected_expost_usd`; `governance.fallback` and `governance.policy.kill_switches`.
2. **`CLAIM_WORK` returns `rec_id` for `ENGINE` work and `decision_point` for `AGENT` work.** `EXECUTE_PLAN(case_id, rec_id)` and `START_AGENT_RUN(case_id, agent, decision_point, …)` need them, and the engine role can't read `DECISION.CASES`. Until then the engine logs `interface_gap` and leaves the case for its lease to expire.
3. **`START_AGENT_RUN` / `END_AGENT_RUN` (WP8a).** `CLAIM_WORK` already hands out `AGENT` work, but nothing records a run yet. `START_AGENT_RUN` should return the exact invocation `message`, so the engine holds no prompts, and both should release the case lease.
4. **Re-lease a `PREPARED` mutation whose lease expired.** `V_DISPATCHABLE` lists only `AUTHORIZED` rows, so a mutation leased by a dispatcher that then stopped is never dispatched or acknowledged. Re-leasing it with `attempt + 1` lets the next dispatcher ask the target for the key's status before anything is resent. `ACK_MUTATION` should also check the lease owner.
5. **Compensation intents carry the original mutation's `external_ref`.** `WITHDRAW_NOTICE` can't find the carrier's claim without it (`contracts/apis/dispatch-target-states.md`, gaps).
6. **`REPLAY_EVIDENCE`, `EXPORT_EVIDENCE_PACK`, `REVERSE_DECISION`** (the rest of WP7b).
7. **Stable denial codes.** The delivered refusals are plain text, which the console shows as-is. Codes (`WRONG_ROLE`, `SEPARATION_OF_DUTIES`, `NOT_PENDING`, `REASON_REQUIRED`, …) would let the UI explain them without parsing text.
8. **Persona read access for Analyst** (ADR-0009).

## Live updates
- **Change stream.** `GET /api/stream` (server-sent events) is backed by one poller per signed-in Snowflake user. The poller reads `V_CASE_INBOX` every `BBC_CT_POLL_MS`, but only while a page listens, so the warehouse can suspend.
  - When a case's `change_token` moves, open pages refetch the case view.
- **Agent traces.** `GET /api/runs/{run}/trace?case=` streams a running agent's trace from the engine's loopback relay (`BBC_ENGINE_RELAY_URL`). It is labelled "live, unrecorded".
  - The run must belong to a case Snowflake lets the person see.
  - The recorded trace replaces the live one when the run ends.

## Server API (browser → control tower)
| Method and path | Purpose |
|---|---|
| `GET / POST / DELETE /api/session` | Session state; sign in as a persona (checked with `WHOAMI`); sign out |
| `GET /api/inbox` | Inbox rows |
| `GET /api/cases/{id}` | Case view for the signed-in person |
| `POST /api/console` | One console input → one entry (an artifact, a confirm card or an error) |
| `POST /api/console/confirm` | Redeem a confirm grant (the only write) |
| `GET /api/console/history?case=` | This session's console entries |
| `GET /api/policy` | Active policy (governance admin) |
| `GET /api/stream?case=` | Change notifications (SSE) |
| `GET /api/runs/{run}/trace?case=` | Live agent trace (SSE) |
| `GET /api/health` | Mode and tape positions |
| `GET / POST /api/fixture` | Tape status and controls (fixture mode only) |

- Every POST requires the session's `X-BBC-CSRF` token and an allowed `Origin`.
- Responses carry `x-bbc-mode`.
