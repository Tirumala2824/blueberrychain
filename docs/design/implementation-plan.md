> **Design record, copied from the approved plan (2026-10-06).**
>
> **Errata:**
> - **Schema rename.** The lifecycle schema written `CASE` below is **`DECISION`** in the implementation, because `CASE` is a reserved word in Snowflake SQL. Read `CASE.<object>` as `DECISION.<object>` (see [ADR-0007](../adr/0007-naming.md)).
> - **Extra user.** Connectors authenticate as a third service user, `BBC_INGEST_SVC`, in addition to the engine and agent users (see [ADR-0003](../adr/0003-auth-and-identity.md)).

# BlueberryChain OS — Implementation Plan (final, implementation-ready)

## Context
- **What we're building.** The repo has been cleared so we can rebuild from scratch. The earlier build (git `b7b0d71`) was a chat UI over a Supervisor and 7 shallow Cortex Agents, with pinned demo data and partly prompt-based governance.
- **Phases 1–13 below** (baseline → genericity audit → opportunity map → competitive filter → frozen concept → agents → boundary → Snowflake → semantic model → tools → evaluation engine → execution → memory) designed a focused, open-source decision platform.
- **The product is "Excursion Value Recovery."** It answers one executive question: *"When a shipment breaks the cold chain, how much of its value can we still save, and who pays for the rest?"*
- **It runs one governed lifecycle:** EVENT → DETECTION → UNDERSTANDING → OPTIONS → EVALUATION → RECOMMENDATION → GOVERNANCE → APPROVAL → EXECUTION → OUTCOME → AUDIT.
- **Who does what:** Snowflake is the governed data, decision and proof foundation. CoCo builds the Snowflake layer. Claude builds the application, engine, simulator, mocks, agents' specs and the UI.
- **Outcome:** a demo that visibly runs DATA → REASONING → DECISION → GOVERNANCE → ACTION → PROOF, unscripted, on a codebase that could evolve into production.

## Final decisions (consolidated; these supersede earlier phase text wherever they differ)
| Area | Decision |
|---|---|
| Setting | California organic blueberry grower-shipper; SAP S/4 stays the system of record; fictional company names |
| Decision points | **D1 Recovery** (disposition + order recovery + liability position + claim notice) and **D2 Settlement** (file / deduct / absorb / defer + counterparty responses) |
| Agents (4) | Excursion Forensics, Recovery Strategist, Claims & Recovery, Evidence Integrity Auditor. Cortex Agents (Claude via Cortex). Invoked only on router triggers. No supervisor: a deterministic case state machine orchestrates |
| AI boundary | AI only for (1) causal judgment over conflicting or free-text evidence, (2) choosing among non-dominated options, (3) claim argument and responses, (4) verifying AI-written statements. **Never numbers, policy or execution** |
| Numbers | `bbc_engine` (Python, seeded Monte Carlo, MILP solver) is the only source. Numeric matching in every `SUBMIT_*`. Template explanations for rule decisions |
| Autonomy | L0 Observe … L4 Execute after approval. Effective level = min(global ceiling, action-type maximum, decider cap, six dimension thresholds) + shadow flag + kill switches |
| Execution | A single gateway `CASE.MUTATE` (validate → authorize → execute → before / after → evidence → actor → timestamps → metric snapshot + drift → approvals). Outbox + dispatcher reading `API.V_DISPATCHABLE`. Idempotency keys, gateway lock, compensation sagas |
| Proof | Hash-chained `LEDGER.ENTRIES`; `VERIFY_LEDGER` (also on a zero-copy clone for the tamper demo); `REPLAY_EVIDENCE` (`received_at ≤ as_of`, independent of Time Travel); evidence-pack export |
| Memory | Insert-only `MEMORY.DECISION_RECORDS` / `DECISION_LOTS` sealed per case; structured precedent retrieval (VECTOR distance after hard filters, no look-ahead); calibration DTs; parameter changes only through governed proposals |
| App | TypeScript monorepo (pnpm): connector SDK + IoT / SAP / carrier / files connectors, engine worker + dispatcher + Cortex agent adapter, mock S/4 + mock TMS, Next.js control tower (spec approved on Day 12). Python (uv): `bbc` CLI, simulator, `bbc_engine`, `bbc_toolkit`, eval harness |
| Hosting | Local / Docker Compose (trial account has no SPCS). New database `BBC_OS`; the old `BLUEBERRY_CHAIN` and `BBC_APP_PG` are untouched unless you confirm teardown |

## Consolidated Snowflake inventory (all amendments from Phases 9–13 applied)
- **Schemas (11):** RAW, REF, GOV, OPS, EVIDENCE, CASE, LEDGER, SEM, AGENT, API, MEMORY.
- **Tables (45):**
  - **RAW:** TELEMETRY, BUSINESS_EVENTS, CONNECTOR_STATE, INGEST_ERRORS.
  - **REF:** PARTIES, SITES, LANES, PRODUCTS, CUSTOMER_SPECS, CONTRACTS, CHANNEL_PRICES, SENSORS, COST_RATES.
  - **GOV:** POLICY_VERSIONS, DECISION_RIGHTS, ROUTER_RULES, HARD_LIMITS, PARAMETERS, MODEL_REGISTRY, METRIC_REGISTRY, AUTONOMY_THRESHOLDS, ACTION_TYPES.
  - **EVIDENCE:** DOCUMENTS, DOCUMENT_CLAIMS, EVIDENCE_PACKS.
  - **CASE:** CASES, CASE_LOTS, CAUSATION_FINDINGS, OPTIONS, RECOMMENDATIONS, POLICY_EVALUATIONS, APPROVALS, MUTATIONS, EXECUTION_PLANS, CLAIMS, OUTCOMES, AGENT_RUNS, TOOL_CALLS, GATEWAY_LOCK.
  - **LEDGER:** ENTRIES, HEAD.
  - **MEMORY:** DECISION_RECORDS, DECISION_LOTS, PARAM_PROPOSALS, BACKTEST_RUNS.
- **Dynamic Tables (20):**
  - **OPS:** LOTS, SHIPMENTS, SHIPMENT_LOTS, CUSTODY_EVENTS, DEVICE_ASSIGNMENTS, ORDER_LINES, INVENTORY_SNAPSHOTS, QC_INSPECTIONS, COUNTERPARTY_RESPONSES, TELEMETRY_ASSIGNED, LOT_THERMAL_BUCKETS, LOT_THERMAL_STATE, LOT_CUSTODY_EXPOSURE.
  - **EVIDENCE:** DOCUMENT_CONSISTENCY.
  - **MEMORY:** CAL_SHELF_LIFE, CAL_ACCEPTANCE, CAL_RECOVERY, CAL_TRANSIT_COST, GOV_EFFECTIVENESS, AGENT_EFFECTIVENESS.
- **Views (3):** `CASE.V_DECISIONS`, `API.V_CASE_INBOX`, `API.V_DISPATCHABLE`.
- **Other objects:**
  - Stage: `EVIDENCE.DOC_STAGE`.
  - Streams (2): thermal buckets, document directory.
  - Tasks (4): detect, extract, deadline watchdog, weekly proposals.
  - UDFs (4): SHELF_LIFE_RATE, PROJECT_SHELF_LIFE_DAYS, CANONICAL_HASH, FEATURE_VECTOR.
  - Semantic view (1): `SEM.EXCURSION_RECOVERY`.
  - Cortex Agents (4).
- **Procedures:**

| Group | Procedures |
|---|---|
| Internal | OPEN_CASES, BUILD_ASSESSMENT, GENERATE_AND_SCORE_OPTIONS, ROUTE, EVALUATE_POLICY, EXECUTE_PLAN, MUTATE, ENFORCE_DEADLINES, COMPUTE_OUTCOME, SEAL_CASE, EXTRACT_NEW_DOCUMENTS, LEDGER.APPEND, COMMIT_MEMORY, FIND_PRECEDENTS, PROPOSE_PARAMETERS, BACKTEST, REBUILD_FEATURES |
| API | CLAIM_WORK, ADVANCE_CASE, START_AGENT_RUN, END_AGENT_RUN, NEXT_ACTIONS, ACK_MUTATION, DECIDE_APPROVAL, GET_CASE_VIEW, VERIFY_LEDGER, REPLAY_EVIDENCE, EXPORT_EVIDENCE_PACK, REVERSE_DECISION, EMERGENCY_STOP, ACTIVATE_POLICY, APPLY_REFERENCE_CHANGE, REVIEW_PROPOSAL |
| AGENT tools (18) | R1–R6, A1–A4, S1–S2, C1–C3, M1, G1–G2 |

- **Post-core only:** PROPOSE_PARAMETERS, BACKTEST, REVIEW_PROPOSAL, CAL_TRANSIT_COST, GOV_EFFECTIVENESS, AGENT_EFFECTIVENESS, the proposals task.

## Repository layout (target)
```
LICENSE  README.md  CONTRIBUTING.md  docker-compose.yml  pnpm-workspace.yaml  pyproject.toml  .env.example
contracts/      schemas/ (decision contract + tools)   raw/ (payloads)   apis/ (mock-s4 OData, mock-tms OpenAPI)
snowflake/      modules/00_account … 90_memory (*.sql)   agents/ (generated DDL)   tests/*.sql
packages/       shared  connector-sdk  connector-iot  connector-sap-s4  connector-carrier  connector-files  engine  agents
apps/           mock-s4  mock-tms  control-tower
python/         bbc_engine  bbc_toolkit  blueberrychain (bbc CLI, sim/, eval/)
docs/           adr/  coco-briefs/  demo/  agents/  frontend-spec.md
.cortex/skills/ bbc-deploy  bbc-verify-proof  bbc-replay  bbc-case-forensics
```

## Execution
- **Follow the day-by-day plan in "Phase 14 — Implementation Plan"** (end of this file).
  - Day 1 starts with task 1.1 (scaffold) and 1.2 (CoCo brief WP1).
  - You run Track B tasks in Cortex Code from the briefs in `docs/coco-briefs/`. I validate each with read-only `snow sql` and `bbc test sql`.
- **Milestone gates:**
  - M1 (Day 8): rule-path end-to-end;
  - M2 (Day 11): agent path;
  - M3 (Day 12): claims;
  - M4 (Day 13): memory;
  - M5 (Day 16): UI.
  
  No optional features start before M5.
- **Each Day-1 spike** (S1–S10) either confirms a design choice or switches it to its documented fallback **before** any dependent task starts. Fallbacks:

| Spike | Fallback |
|---|---|
| ASOF not allowed in incremental DT | Interval join |
| Triggered task not available | 1-minute scheduled task |
| VECTOR can't be returned from a UDF | ARRAY + cast |
| `scipy.milp` unavailable | Greedy assignment |
| No agent REST with PAT | `DATA_AGENT_RUN` |
| Retention refused | 1-day retention; replay unaffected |

## Verification (end-to-end)
- **Automated, per milestone:**
  - `bbc test sql` (all `snowflake/tests/*.sql` invariants return 0 rows);
  - `uv run pytest` (engine golden test = the Phase 11 worked example, determinism, formula parity);
  - `pnpm -r test` (connectors vs mocks, dispatcher idempotency);
  - `bbc eval` (0 policy violations, 100% citation validity and numeric match);
  - `tests/e2e/test_s_a.py` / `test_s_b.py` / `test_s_c.py` (3 consecutive passes from `bbc demo reset`);
  - Playwright UI E2E.
- **Proof checks:**
  - `API.VERIFY_LEDGER` = OK;
  - tampering with one row in a zero-copy clone is detected at the exact `seq`;
  - `API.REPLAY_EVIDENCE` reproduces the pack hash;
  - every number in the demo deck is cross-checked against SQL.

---

# Appendix — Design phases 1–14 (the rationale behind the decisions above)

# Phase 1 — Baseline Analysis (no code)

**Source:** `docs/BlueberryChain_OS_CoCo_CLI_Hackathon.pptx`, 7 slides. All text was extracted. There are no speaker notes, and the 3 embedded images are only a logo and backgrounds.

Items marked **[repo]** come from the prior implementation (git `b7b0d71`). They are used only where they confirm or contradict a claim in the PPT.

The provisional architecture draft written earlier was **set aside** as instructed. It will be redesigned from this baseline.

---

## Part 1 — What the PPT contains

### 1. Business problem
- **Stated (slide 1):** "Governed, auditable farm-to-retail cold-chain traceability on Snowflake + CoCo CLI."
- **Argued (slide 2):**
  1. A fragmented SAP stack (PP · MM · LE/TM · QM · WM/EWM · SD · FI/CO).
  2. Each silo defines its own metrics, so the same question gets different answers.
  3. Verification is manual: inspection PDFs, dispatch records and invoices are reconciled by hand.
  4. No audit trail links a decision to the numbers that justified it.
- **Observation:** the title promises *traceability*, but the content argues *metric consistency + decision auditability + manual reconciliation*. Lot genealogy and traceability are barely developed anywhere in the deck.

### 2. Industry
- **As stated:** "GCC agri-perishables cold chain — organic blueberries, farm → DC → retail (Tracy DC → Costco)."
- **Observation:** the geography is internally inconsistent.
  - GCC implies a Gulf **import** chain: air or sea from Peru, Chile or South Africa, then customs, then a Gulf DC.
  - Tracy DC, Costco and "Ranch 14 Block 7, harvested this morning" describe a **California grower-shipper**.
  - These are different value chains, with different custody parties, transit times and rules.

### 3. Business workflow (implied)
- **Main flow:** Harvest at ranch/block (PP) → lot → pre-cool / cold hold → reefer transport (LE/TM) → quality inspection (QM) → DC receipt & storage (WM/EWM) → inventory / ATP → order promise (SD) → invoice, landed cost, credit note, grower settlement (FI/CO) → replacement sourcing: PO (MM) or harvest request (PP).
- **Exception path shown (Demo 1):** excursion → hold → update ATP → adjust order promise → credit note → landed cost → notify → rank alternative coverage → confirm replacement PO.

### 4. Existing pain points

| Today (PPT) | Claimed fix |
|---|---|
| Module hopping & t-codes | One conversation |
| Seven metric definitions | Defined once, governed |
| Manual invoicing | 47/47 arrivals settled autonomously |
| Silent errors | Every action audit-linked to its metric snapshot |
| Manual PDF / dispatch / invoice reconciliation | **Not solved**; moved to the Phase-2 roadmap |
| No decision→numbers trail | Decision log with metric snapshot |

### 5. Existing personas
- **Listed:**
  - Ranch ops: harvest-to-hold decisions.
  - Logistics & cold-chain managers: reefer integrity, routing.
  - Quality inspectors: temperature compliance, shelf life.
  - Finance / AR: landed cost, credit notes, settlement.
  - Sales & order promise: ATP, order coverage.
- **Missing:**
  - carriers;
  - growers as settlement counterparties;
  - the customer / buyer;
  - approvers with defined decision rights;
  - auditor / compliance;
  - data steward.
- **All personas share one chat with identical orchestration.** No decision rights are assigned per persona.

### 6. Available data

| Entity | Volume | Note |
|---|---|---|
| Harvest lots | 199 | |
| Sensor readings | 23,880 | ≈120 per lot, a thin time series |
| Reefer telemetry rows | 11,700 | ≈60 per shipment |
| Shipments | 195 | 47 Tracy DC arrivals used in Demo 2 |
| Inventory snapshots | 732 | Daily snapshot data, so it can't simply be summed across dates (semi-additive) |
| PO lines | 28 | Too few for order promise or allocation to involve real trade-offs |
| Semantic model | 12 tables, 12 relationships, 48 metrics (7 canonical), 3 verified queries | |

- All of this is synthetic, deterministic seed data **[repo]**.
- **Not present:** documents, contracts and clauses, custody / handoff events, customer specs (e.g. minimum shelf life at receipt), carrier data.

### 7. Existing Snowflake requirements
- A semantic view as the single source of truth, queried through Cortex Analyst (natural language → governed SQL).
- 4 incremental Dynamic Tables with a 1-minute target lag.
- 13 stored procedures as agent tools: "read metrics FIRST from the semantic view, then mutate".
- `AUDIT.DECISION_LOG`, which stores a metric snapshot with every state change.
- `APPROVAL_QUEUE` for value-gated human approval.
- 8 Cortex Agents; the Supervisor is published to Snowflake CoWork (Snowflake Intelligence).
- Snowflake Postgres for persistent chat memory.
- SPCS app deploy is on the roadmap; it's blocked on a trial account **[repo]**.
- "100% Snowflake-native, reproducible from version-controlled DDL".
- CoCo CLI:
  - #TABLE schema pull;
  - `$dynamic-tables`, `$semantic-view`, `$cortex-agent` and `$agent-optimize` skills;
  - `/sql` + Plan Mode;
  - MCP + connections.toml;
  - automated verification: proof queries, verified-query tests, autonomy checks, audit-snapshot assertions.

### 8. Existing AI concepts
- A Supervisor routing to 7 specialists (cold-chain, finance, quality, inventory/ATP, order-promise, harvest, procurement), driven by playbooks.
- Cortex Analyst text-to-SQL.
- A conversational UI that renders charts and cards.
- Credit notes sized automatically from a risk score.
- Ranking of alternative supply.
- Agent tuning with `$agent-optimize`.
- **Roadmap:** document ingestion with Cortex; continuous agent evaluation on live traffic.

### 9. Existing automation concepts
- A 19-step chain started from one sentence.
- Autonomous settlement of 47 arrivals.
- A table-driven autonomy policy that can be retuned without redeploying.
- Confirm before spending.
- Incremental refresh of the Dynamic Tables.
- "Add a 9th agent in 6 steps."

### 10. Existing governance requirements
- **Stated:**
  - metrics defined once and asserted;
  - every action linked to a metric snapshot;
  - value-gated human approval;
  - server-side gates ("no pending approval ever leaked a side effect");
  - confirm before spending;
  - reproducible DDL.
- **Gaps [repo]:**
  - The autonomy *level* is logged but not enforced. `APPROVAL_REQUIRED` only works if the threshold is set to 0, and FULL_AUTO tools skip the policy check entirely.
  - Approvals in CoWork are parsed from chat text. The repo itself notes it "cannot prove the text came from the human".
  - Nobody checks the approver's identity or role, and the proposer and approver can be the same.
  - The audit log is an ordinary mutable table, with no tamper evidence.
  - Nothing is re-validated at approval time.
  - The record holds the metrics, but not the alternatives considered, the decider (model/version) or the policy version.
  - Agents ran under the user's ACCOUNTADMIN default role.

### 11. Existing demo scenarios
- **Demo 1, excursion:**
  - A human types "…3.8 h above 1.8 °C. Handle it."
  - The chain runs HOLD_LOT → UPDATE_ATP → ADJUST_ORDER_PROMISE (Costco PO-6001) → credit note $19,792 → landed cost → notify → rank coverage → ask to confirm.
- **Demo 2, settlement:** 47 invoices, $1.85M net, 47 grower settlements, downloadable PDFs.
- Both start from a typed sentence against **pinned** seed state, restored by a reset script **[repo]**. The system detects nothing by itself.

### 12. Existing measurable outcomes

| Claim | What it actually measures |
|---|---|
| 47/47 invoiced, $1.85M net | Batch throughput on synthetic data, not a before/after business outcome |
| 19-step autonomous chain | Activity count; more steps ≠ more value |
| 3.5× overstatement blocked (1.689M vs 0.485M kg, −71%) | A data-modeling guard against summing snapshot dates. Its size depends on how many dates are summed (5 here) |
| 7 canonical metrics defined once | Hygiene assertion |
| 8 agents implemented & granted | Build effort |
| No pending approval leaked a side effect | A real governance invariant, and the strongest claim in the deck |

**Missing:** time to detect, time to decide, value at risk protected, shrink avoided, claims recovered, change in shelf-life-adjusted on-time delivery, and automation rate with zero policy violations.

### Inconsistencies found
1. **The $1.85M headline appears to come from the run before the rounding bug was fixed [repo].**
   - The repo's corrected net is $1,887,657.18 (≈ $1.89M).
   - The earlier run priced at $11.00 instead of $11.20: gross $1,905,736.69, net ≈ $1.854M. That matches the PPT.
2. "8 proof queries" in the PPT vs "9 proofs" in the repo.
3. GCC vs a California / Costco geography.
4. "100% Snowflake-native", yet the UI is hosted locally, chat memory sits in Snowflake Postgres, and SPCS is blocked.
5. Slide 4 says `$cortex-agent` built the agents. The repo says the cortex CLI was unavailable and the agents were created with native DDL.
6. The title says "traceability", but the content barely covers it.
7. **Demo 1 issues a customer credit note for a lot that was harvested that morning and held before shipping.**
   - There's no invoiced sale to credit, so the commercial event is wrong.
   - The right event is a grower deduction, a provisional reserve, or nothing.

---

## Part 2 — Assessment

### A. Genuinely valuable (keep the idea, rebuild the implementation)
1. **Decision provenance:** every action is permanently tied to the governed numbers that justified it. This is the best idea in the deck.
2. **Domain-correct metrics:**
   - Shelf-life-adjusted on-time delivery: a punctual delivery whose shelf life is used up doesn't count.
   - Quality-adjusted fill rate: measured on accepted kg, not shipped kg.
   - Quality-adjusted ATP: held stock is excluded.
   - True landed cost, including cold-chain shrink and claims.
   - Minute-weighted temperature compliance.
3. **Governance enforced in the server, not the model:** gates hold even when the LLM misbehaves.
4. **Temperature history → money:** shrink deductions come from actual thermal history, linking physical evidence to settlement.
5. **Cross-silo ripple:** one excursion hits quality, inventory, sales and finance at once. That ripple is the real pain.
6. **Policy as data:** autonomy thresholds live in tables. The idea is right; enforcement is unfinished.
7. **Engineering rigor:** reproducible DDL and executable proof assertions.
8. **Semi-additive correctness:** worth keeping as a hidden guarantee, not a headline.

### B. Generic
1. **"One conversation replaces the SAP module stack":** a crowded ERP-copilot pitch, and not credible. SAP stays the system of record.
2. **A Supervisor with one agent per department or SAP module:** the default template, organized by org chart instead of by decisions.
3. **Cortex Analyst text-to-SQL over a semantic view:** the standard Snowflake pattern.
4. **A chat UI** with metric cards, charts, a timeline and chips, plus persistent chat memory.
5. **Commodity features:** notifications, PDF generation, Vega-Lite charts.
6. **Agent count as the scaling story** ("add a 9th agent in 6 steps").

### C. Unnecessary
1. **7 specialist agents.**
   - Inventory/ATP, harvest and procurement each own exactly one tool.
   - Quality and cold-chain both own HOLD_LOT.
   - The specialists pass their tools to the Supervisor but not their instructions **[repo]**. In practice it's one agent with 13 tools, plus a failure mode where a missing grant silently drops tools.
2. **An LLM doing arithmetic:** contract-price invoicing, ATP recalculation and landed cost are calculations. Running them through an agent chain adds non-determinism, latency and cost.
3. **Snowflake Postgres + Prisma + an IP allowlist** just for chat threads: a second data store with no decision value.
4. **48 metrics when 7 drive decisions.** The other 41 have no clear governance status.
5. **Approvals by chat text** (CoWork): weak by design.
6. **Pinned demo state and a reset script:** hardcoded scenarios.
7. **"19 steps" as a KPI.**

### D. Can be improved
1. **Detection:**
   - The system should detect the excursion from telemetry itself. Today a human types "handle it".
   - The incremental Dynamic Tables were fed static seed data, so "live" was never actually exercised.
2. **Decision quality:**
   - The quantity that matters is *remaining shelf life in days* versus each customer's spec. The current points-based risk score uses hand-set weights.
   - A binary hold/release destroys value. A short excursion may cost only 1–2 days of shelf life, and sending the lot to a channel that sells it sooner can recover most of its value.
   - Disposition should be an economic optimization, not a hold.
3. **Workflow order:**
   - Decide what happens to the lot first, then reallocate orders, then attribute liability, then settle provisionally, then confirm the outcome at receipt.
   - Today a credit note is issued before the lot's fate is even known.
4. **Liability:**
   - The party holding the lot when it warmed (grower pre-cool, carrier reefer, DC dock) decides who pays.
   - The baseline never works this out, yet claims recovery is where the money is.
5. **Governance:**
   - Enforce every autonomy level.
   - Assign decision rights by role and persona, not only by value.
   - Require a real approver identity, and an approver who isn't the proposer.
   - Re-validate before executing.
   - Run agents under least-privilege roles.
   - Keep a tamper-evident record of alternatives, decider (rule / model / version) and policy version.
6. **Proof:**
   - Be able to replay the evidence as it was at decision time.
   - Track outcomes (predicted vs actual shelf life at receipt), so decision quality itself becomes measurable.
7. **Documents belong in the core:** manual PDF reconciliation is the stated pain. Extract inspection certificates and bills of lading, and cross-check them against telemetry, now rather than in Phase 2.
8. **Integration realism:** read from SAP, carriers and IoT, and write actions back (stock block, credit memo request, carrier claim), rather than "replacing" those systems.
9. **LLM economics:** rules decide routine cases, the LLM handles genuine judgment calls, and the boundary between the two is recorded.
10. **Data realism:** physics-based telemetry, enough orders for real allocation trade-offs, and simultaneous incidents.
11. **Outcomes:** measure business KPIs (see the gaps under #12), not activity counts.
12. **Story consistency:** pick one geography and use correct numbers.

### E. Candidate core differentiator
**"Provable autonomous exception management for perishables":** remaining shelf life is the measure every team shares, and every decision is backed by proof that an outside party can check.

1. **Remaining shelf life as the one physical quantity shared by every silo.**
   - It's computed from thermal history.
   - It drives disposition (quality), allocation against customer specs (sales) and settlement/liability (finance).
   - That answers "same question, different answers" with physics, not just a metric dictionary.
2. **Detect → decide → act without a prompt.**
   - Excursions are detected from the data.
   - Fixed models generate options with quantified outcomes.
   - The LLM is called only when a recorded reason applies: near tie, conflicting evidence, high exposure, strategic customer, or a novel case.
3. **Liability attribution → automatic claims and settlement.**
   - Telemetry plus the custody chain identify the responsible party.
   - Contract clauses then produce the claim.
   - The baseline only *spends* money (credit notes); this *recovers* it.
4. **Proof a counterparty can verify:**
   - a tamper-evident decision ledger;
   - replay of the evidence as it was at decision time;
   - outcome tracking;
   - stretch: share the evidence slice with the carrier or customer through Snowflake Secure Data Sharing. That settles disputes on shared facts and gives the deck's "multi-party consortium" item a concrete job.
5. **Safe rollout:** shadow → assist → auto under enforced decision rights. This is what makes it credible for production.

The baseline's best idea, an action linked to its metric snapshot, grows into a full chain: **decision ↔ evidence ↔ options ↔ policy ↔ approver ↔ action ↔ outcome**.

---

## Open questions: defaults chosen so work isn't blocked (each can be overridden)
1. **Geography:** a **California grower-shipper** (ranch → packhouse → reefer → Tracy-style DC → retail).
   - It matches the existing scenario, the data and the SAP context.
   - A GCC import lane (sea/air, customs custody) becomes a later expansion that tests whether the platform generalizes.
2. **System of record:** **SAP stays.** We integrate both ways: read from it, and write actions back (stock block, credit memo request, sales-order change).
3. **Brand names:** **fictional names** in the public OSS repo and demo, with real-world-style retailer archetypes (e.g. a club-warehouse retailer with a 10-day shelf-life-at-receipt spec). A real brand name would imply a relationship that doesn't exist.
4. **Primary buyer:** **VP Supply Chain / Quality** owns the decision loop. **Finance** supplies the ROI proof (shrink avoided, claims recovered).

---

# Phase 2 — Genericity Audit (critical judge view, no solution yet)

Assumption: **100 other teams have Cortex, agents, semantic views, MCP and dashboards.**

**The default project**, the one most of those teams will build:
1. Synthetic data.
2. → Dynamic Tables.
3. → semantic view.
4. → Cortex Analyst.
5. → a Supervisor with department agents.
6. → stored-procedure tools.
7. → a dollar-threshold approval.
8. → an audit table.
9. → a chat UI with charts.
10. → a slide reading "X agents, Y metrics, Z steps".

**The baseline matches 9 of those 10.** The only real departures:
- a metric snapshot on every write;
- shrink calculated from temperature history;
- cold-chain-specific metric definitions.

**A judge's 30-second verdict:**
- "Snowflake quickstart with blueberry data."
- The autonomy is triggered by a prompt, and the governance is partly prompt-based.
- The numbers are synthetic, and one appears wrong.
- The stated pain point (document reconciliation) is never addressed.

Severity: **H** = High, **M** = Medium, **L** = Low. Columns: Existing approach · Why generic · What rival teams can easily do · Severity · Transformation direction.

## 1. Generic AI-agent patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 1.1 | Supervisor + 7 department agents | Cortex Agents quickstart / CrewAI / LangGraph template; agents mapped to the org chart | 8× `CREATE AGENT` + `agent_toolset` in an afternoon | **H** | Agents defined by *decision rights and accountability*; prove each needs judgment a tool can't give |
| 1.2 | Agent count sold as scale ("8 agents", "9th in 6 steps") | Inflation; judges discount it | Show 12 agents | **H** | Lead with decisions made, value protected, errors avoided |
| 1.3 | "One sentence → 19-step chain" | Multi-step tool use is every framework's demo; step count is vanity, and long chains fail more | Any 10-tool agent | **H** | Each step necessary and backed by evidence; correctness checked against an oracle (best answer known in advance), not length |
| 1.4 | Agents are thin wrappers around create/update procedures (HOLD_LOT, UPDATE_ATP, CREATE_PO) | "LLM calls a procedure" is the base pattern; the intelligence is all prompt | Identical | **H** | Reasoning over quantified option sets from domain models; contribution measured against a rules-only baseline |
| 1.5 | The business process lives in the Supervisor's prompt | Untestable and unversioned: what if it skips a step? | Everyone writes playbook prompts | **H** | Explicit, deterministic process; the LLM only at judgment points |
| 1.6 | Specialists pass their tools to the Supervisor but not their instructions, so they're only tool groupings | Functionally one agent with 13 tools; architecture theater | Same | **H** | No split unless the split adds reasoning or authority |
| 1.7 | "Tuned with `$agent-optimize`" | No eval set, no score shown | Every CoCo team says it | M | A published eval set with known best answers and scores |
| 1.8 | Approve / Reject card above $X | Every agent demo has an approve button | Trivial | M | Rights by role and party, proposer ≠ approver, re-checked before execution, enforcement proven |

## 2. Generic Snowflake patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 2.1 | RAW → Dynamic Tables → semantic view → Cortex Analyst → Cortex Agents | Snowflake's own reference architecture; a feature tour | It's the quickstart | **H** | Each feature does problem-specific work that's hard to do elsewhere, and the reason is stated |
| 2.2 | 4 incremental Dynamic Tables (1-minute lag) over **static** seed data | A checkbox; freshness never exercised or measured | Copy-paste | M–H | Data actually arriving; event → decision latency measured |
| 2.3 | Stored procedures as agent tools | The default custom-tool type | Same | M | Value is what the procedures *enforce*; prove it with adversarial tests |
| 2.4 | Published to Snowflake Intelligence / CoWork | One click | Every team | M | Only where it serves a persona; never as "the product" |
| 2.5 | Snowflake Postgres + Prisma for chat memory | Feature collecting; a second store with no decision value | Easy | M | Justify it or remove it |
| 2.6 | "100% Snowflake-native" | Marketing, and false here (the UI runs locally) | Everyone claims it | M | Precise boundaries: what runs where, and why |
| 2.7 | 199 lots / 23,880 readings / 28 PO lines | Toy scale, so nothing looks stress-tested | Everyone has toy data | M | Realistic volume and variance, concurrent incidents, cost and latency measured |
| 2.8 | CoCo used to write DDL (`$semantic-view`, `$dynamic-tables`, `$cortex-agent`, `/sql`) | **Every team gets these exact skills**; it's the floor | 100% of teams | **H** | CoCo as part of the product's *operating model*: project-specific, versioned, repeatable skills that make sense only here |

## 3. Generic semantic-layer patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 3.1 | "Single source of truth: metrics defined once" | The pitch of every semantic layer (dbt SL, LookML, Cube, Snowflake semantic view) | Default claim | **H** | Show *concrete harm averted*: a decision that changes under a rival definition |
| 3.2 | 48 metrics / 12 tables / 3 verified queries | Size used as a flex | Easy | L–M | Fewer metrics, each driving a decision, with owner, version and test |
| 3.3 | Guard against summing inventory snapshots as a headline (3.5×, −71%) | A textbook data-modeling rule (snapshot data can't be summed across dates) that every semantic layer handles; "3.5×" just reflects the 5 dates summed | Any BI-literate team | M | Keep as an invariant test, don't headline it |
| 3.4 | Cortex Analyst text-to-SQL as the agents' main reasoning tool | An out-of-the-box product; the accuracy is Snowflake's, not ours | Every team | **H** | Text-to-SQL as a helper, never the decision engine |
| 3.5 | Metric snapshot written to the audit row | More original, but `OBJECT_CONSTRUCT` into a log is easy to copy | Moderate | M | Snapshot must be *verifiable*: replayable, tamper-evident, tied to the policy version |
| 3.6 | Metrics have no owner or change process | Real governance means stewardship and versioning | — | M | Versioned metric definitions; each decision records the version it used |

## 4. Generic chatbot patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 4.1 | "One conversation replaces the SAP module stack" | The incumbents' own pitch (SAP Joule, Copilot for Dynamics 365, Oracle); enterprise judges reject "replace SAP" | Every ERP-copilot team | **H** | Complement the system of record; write back into it |
| 4.2 | ChatGPT-style UI: markdown, cards, charts, chips, typewriter effect | Generated in an hour; indistinguishable from other entries | Everyone | **H** | UI organized around the work object (an incident or a decision), not a conversation |
| 4.3 | Prompt-triggered ("…Handle it.") | Reactive: a human noticed first, which defeats "autonomous" | Everyone | **H** | Event-driven: the system notices first |
| 4.4 | One chat surface for all 5 personas | Blurs accountability; enterprises separate duties | Everyone | M–H | Role-specific responsibilities and rights |
| 4.5 | Persistent threads, suggestion chips, warm persona voice | Commodity | Everyone | L | Drop from the story |

## 5. Generic RAG patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 5.1 | Roadmap: "ingest inspection PDFs / dispatch records via Cortex" | Likely to become Cortex Search over PDFs, i.e. chat-with-your-docs | Every team | M (future risk) | Documents as **structured evidence** reconciled against telemetry and contracts; mismatches trigger action |
| 5.2 | The stated pain (manual PDF reconciliation) isn't addressed at all | The problem slide promises what the build never touches | — | **H** (credibility) | Document verification inside the core loop |
| 5.3 | Risk: past incidents surfaced by vector search | Generic RAG over tickets | Everyone | M | Precedents structured and weighted by outcome, not text similarity |

## 6. Generic dashboard patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 6.1 | KPI tiles with big numbers and trend colours | Every dashboard; Snowflake Intelligence renders charts natively | Everyone | M | Visuals that *explain a decision*, not report a KPI |
| 6.2 | Temperature-history and coverage-ranking charts | Cold-chain IoT vendors (Sensitech, Tive, Emerson) have offered this for a decade | Everyone + incumbents | M | Every chart tied to the action and proof it supports |
| 6.3 | Agent-generated Vega-Lite charts, PDF cards | Commodity | Everyone | L | Drop from the story |

## 7. Generic autonomous-workflow patterns
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 7.1 | Linear hold → ATP → re-promise → credit note → landed cost → notify | It's an RPA/BPM flow (ServiceNow, Power Automate, n8n); a rule does it without an LLM | Everyone | **H** | Decisions with *real trade-offs* where rules aren't enough; show where AI changes the outcome |
| 7.2 | Autonomy by dollar threshold | Expense-approval logic | Everyone | M | Rights that take risk, evidence and role into account; policy what-if |
| 7.3 | "47/47 arrivals invoiced autonomously" | A billing run every ERP does nightly; an LLM *subtracts* value (cost, non-determinism) | Everyone | **H** | Value lives in exceptions: disputed and quality-adjusted settlements |
| 7.4 | "Hold" as the default response | A compliance reflex that destroys recoverable value | Everyone | **H** | Decide the lot's fate as an economic problem |
| 7.5 | Pinned seed state + reset script | Judges spot demo theater | Everyone | **H** | Unscripted: fault injected live, outcomes emerge, judges choose parameters |
| 7.6 | Notifications to ranch and account managers | Commodity | Everyone | L | — |

## 8. Technically impressive, not differentiated
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 8.1 | 8 agents with `agent_toolset` wiring and grants | Shows Snowflake skill, not product insight | Teams that read the docs | **H** | See 1.1 |
| 8.2 | IoT ledger with Ed25519 signatures and Merkle roots [repo] | The "blockchain for supply chain" trope (IBM Food Trust era); cryptography with no verifier is theater | Bolt-on in an hour | M–H | Proof needs a **verifier** and a **consequence**: who checks it, and which dispute it settles |
| 8.3 | PDF builder as a JavaScript UDF; presigned stage links | Clever plumbing that judges don't score | — | L | — |
| 8.4 | Snowflake Postgres + Prisma integration | Effortful but irrelevant | — | M | See 2.5 |
| 8.5 | Bundled Vega-Lite, streaming (SSE) plans | Engineering detail | — | L | — |

## 9. "Just another AI assistant"
| # | Existing approach | Why generic | Rivals can easily | Sev | Transform direction |
|---|---|---|---|---|---|
| 9.1 | Chat-first, ask anything, every persona | That's the definition of an assistant | Everyone | **H** | The system acts unprompted; humans own decision rights |
| 9.2 | Cortex Analyst Q&A ("what's ATP at Tracy?") | Assistant behaviour | Everyone | **H** | Secondary at most |
| 9.3 | Deployed in Snowflake Intelligence / CoWork | Literally Snowflake's assistant product | Everyone | **H** if shown as the product | — |
| 9.4 | Agent narrates warm summaries | Assistant tone | Everyone | M | The decision record matters more than the prose |

## 10. Difficult to prove
| # | Claim | Why hard to prove | Rivals | Sev | Transform direction |
|---|---|---|---|---|---|
| 10.1 | "Autonomous" | Every run starts from a human sentence on pinned state | Same claim | **H** | Unprompted detection; event → decision time measured |
| 10.2 | "Governed" | Autonomy level unenforced; chat approvals can't be tied to a person | Same claim | **H** | Adversarial tests a judge can run live: attempt a bypass, watch it refused |
| 10.3 | "Same question, same answer" | The divergence itself is never shown | Same claim | **H** | Two definitions → two answers → a different decision, shown concretely |
| 10.4 | "$1.85M settled" | Synthetic, and appears to come from the buggy $11.00 run [repo] | — | **H** (credibility) | Every figure reproducible from the repo |
| 10.5 | Credit note "auto-sized from risk score" ($19,792 at risk 69.3) | No contractual or economic basis: "why that number?" | — | **H** | Every dollar traceable to a contract clause × a quantity |
| 10.6 | "Tuned answer accuracy" | No metric | Same claim | M | Published eval |
| 10.7 | "No pending approval leaked a side effect" | True, but shown on only a handful of cases | — | M | Adversarial and randomized (property-based) tests |
| 10.8 | "Consortium-ready", "multi-tenant GCC", "9th agent in 6 steps" | Unfalsifiable roadmap claims | Same claim | M | Cut them, or demonstrate one |
| 10.9 | "Real-time" | The data is static | Same claim | M | Live ingestion with measured lag |

## 11. Sounds impressive, weak business value
| # | Claim | Why weak | Rivals | Sev | Transform direction |
|---|---|---|---|---|---|
| 11.1 | 19-step chain | Vanity (see 1.3) | Same | **H** | Value per decision |
| 11.2 | 47/47 invoiced | Solved problem (see 7.3) | Same | **H** | Exception value |
| 11.3 | 3.5× overstatement blocked | Only valuable if a decision changes, and none is shown | Same | M | Tie it to a decision |
| 11.4 | 7 canonical metrics | Hygiene | Same | M | — |
| 11.5 | One conversation for every persona | Enterprises want separated duties (see 4.4) | Same | M–H | — |
| 11.6 | Coverage ranked by temperature compliance alone | A one-column sort; ignores distance, remaining shelf life, cost and customer spec | Trivial | M | Multi-factor feasibility |
| 11.7 | Hold-first response | Destroys recoverable value (see 7.4) | Same | **H** | — |
| 11.8 | PDFs, charts, notifications | Commodity | Everyone | L | — |

## Stress test of our own Phase-1 candidate differentiators
| Candidate (Phase 1 §E) | Genericity risk | Sev | Bar it must clear |
|---|---|---|---|
| Shelf life as the shared measure | Dynamic shelf-life and first-expired-first-out (FEFO) models already exist commercially and in research; alone it's just another metric | M | Must drive decisions across teams *and* be checked against real outcomes |
| Detect → decide → act | Event-driven "ambient agents" are becoming the next default | M | Rules-vs-LLM boundary backed by numbers |
| Liability attribution → claims | Rare in hackathons, and real money | L | Credible contract terms and custody data |
| Hash-chained ledger | Blockchain trope; SHA2 chaining is an hour's work | **H** | A real counterparty verifier and a real consequence |
| Shadow → assist → auto | Standard ML rollout practice | M | A maturity signal, not a differentiator |
| "LLM only when needed" | Becoming a common cost talking point | M | Escalation rate, accuracy vs rules and cost per decision, all published |

## Tally
- 65 issues in total: **30 High**, 28 Medium, 7 Low. Split ratings such as M–H are counted at the lower level.
- The High issues cluster in four places:
  - agent architecture (1.x);
  - chat positioning (4.x, 9.x);
  - scripted autonomy (7.x);
  - unprovable claims (10.x).

## Differentiation tests (criteria only, not a solution)
1. Could a team build it from the Snowflake quickstart in a day? If yes, it isn't a differentiator.
2. Does removing the LLM change the outcome? If not, the LLM is decoration.
3. Can a judge break it live and watch governance hold?
4. Does every dollar figure trace to a quantity × a contract term?
5. Does anyone *outside* the company have a reason to verify the proof?
6. Does the demo work unscripted, with judge-chosen inputs?
7. Is every Snowflake feature doing work that's specific to this problem?
8. Is the claimed value a business outcome, not an activity count?

---

# Phase 3 — Decision Opportunity Map (business first, no winner yet)

**Setting:** a California organic blueberry grower-shipper (the Phase-1 default). The chain runs ranch → packhouse / pre-cool → reefer → DC → retail, with SAP as the system of record.

**Value scale, derived from the repo [repo]:**
- 47 arrivals = $1.94M gross, about **$41k per arrival**.
- Shrink deductions were about **2.7% of gross**.
- A 4,200 kg lot at $11.20/kg ≈ **$47k**.
- These figures are for scale only. They are not claims.

**Scoring:** 1–5 on each of Differentiation (D), Business Value (BV), Technical Feasibility (TF) and Demo Impact (DI). The score is D × BV × TF × DI, out of a maximum of 625.
- TF assumes a solo build of 2+ weeks using simulator data.
- **Fit /9** counts how many of the 9 required criteria the candidate meets: hard to do manually, cross-functional, real-time, multi-dataset, financial impact, Snowflake benefit, meaningful agent, demonstrable in context, governed action.

## Candidates

### C1 · In-transit excursion disposition & value recovery
1. **Problem:** after a reefer excursion, the default response is a hold or a rejection, which destroys recoverable value.
2. **Decision:** for each lot, pick one: continue, re-route to a nearer or less-strict customer, expedite, QC hold, downgrade to processing, or reject. It has to be decided before the re-route window closes.
3. **Why humans struggle:** they must combine thermal history, remaining shelf life, every open order's spec, transit times and channel prices within hours. This happens by phone and spreadsheet, so the fallback is to hold.
4. **Data:** reefer and pulp telemetry, lot genealogy, shelf-life parameters, open orders and customer specs (minimum shelf life at receipt), lanes and ETAs, channel prices.
5. **Reasoning:** predict shelf life from temperature history; check feasibility (shelf life at arrival ≥ spec); expected value of each option under uncertainty; strategic-account trade-offs.
6. **Agents:** a Disposition agent for near-ties and strategic accounts, on top of a fixed scorer.
7. **Action:** TMS re-route, SAP sales-order change or stock block, QM inspection lot, customer notice.
8. **Impact:** each rescued arrival is worth roughly $41k. Fewer rejections and less shrink.
9. **Hard to copy:** it needs a working shelf-life model, spec-aware economics and live feasibility checks. Telematics vendors raise alerts but don't decide.
10. **Demo:** very high. A fault is injected live, a shelf-life clock is visible, and money is saved.
11. **Difficulty:** Medium.

### C2 · Predictive reefer intervention (before the fruit warms)
1. **Problem:** reefer units degrade (short-cycling, defrost faults, setpoint drift, open doors) hours before pulp temperature rises.
2. **Decision:** intervene now (call the driver, divert to repair, transload, swap the trailer) or keep watching.
3. **Why humans struggle:** weak, noisy signals across many units cause alert fatigue, and nobody can weigh the cost of acting against the expected loss.
4. **Data:** supply and return air, setpoint, mode, alarms, door and fuel readings; GPS and route; load value; repair and transload network.
5. **Reasoning:** early-warning anomaly detection; time-to-impact estimate; probability × value at risk vs the cost of intervening.
6. **Agents:** a Logistics-intervention agent (or the pre-excursion stage of C1).
7. **Action:** carrier dispatch instruction, transload booking, ETA change.
8. **Impact:** prevents losses instead of mitigating them; up to a full load (~$41k) per avoided failure.
9. **Hard to copy:** reefer-physics features combined with commercial context. Vendors alert; they don't decide the economics.
10. **Demo:** high: "it acted before the fruit warmed."
11. **Difficulty:** Medium-High (a credible anomaly model on synthetic data).

### C3 · Shelf-life-aware allocation & pre-dispatch acceptance gate
1. **Problem:** first-in-first-out allocation sends worn-out lots to strict-spec, long-haul customers and the freshest lots to local ones, which causes rejections.
2. **Decision:** which lot goes to which order, and whether a load should ship at all.
3. **Why humans struggle:** the problem is combinatorial, remaining shelf life changes hourly, and specs vary by customer.
4. **Data:** remaining shelf life per lot, orders, specs, transit times, inventory, prices, penalties.
5. **Reasoning:** prediction plus an assignment optimization; sensitivity to forecast error.
6. **Agents:** an Allocation agent for exceptions only. The solver does the routine work, so the agent's role is thin.
7. **Action:** SAP delivery and lot assignment, WM pick instruction, ship/hold gate.
8. **Impact:** fewer rejections and chargebacks; better quality-adjusted fill rate.
9. **Hard to copy:** moderately. Dynamic first-expired-first-out allocation exists in research and from some vendors.
10. **Demo:** medium. Optimization isn't dramatic, but a before/after rejection rate is persuasive.
11. **Difficulty:** Medium.

### C4 · Penalty-aware re-promise under a supply shock
1. **Problem:** when supply drops, whoever shouts loudest gets the fruit.
2. **Decision:** which orders to short, substitute, delay or fill from alternative supply, and what to tell each customer.
3. **Why humans struggle:** customers have different penalties, for example on-time-in-full (OTIF) fines such as Walmart's widely reported 3%-of-COGS. Contracts, relationship value and real-time ATP all matter at once.
4. **Data:** orders, quality-adjusted ATP, penalty clauses, customer tiers, substitution rules, alternative supply.
5. **Reasoning:** optimization plus strategic judgment, since relationship value isn't purely numeric.
6. **Agents:** a Fulfillment-recovery agent.
7. **Action:** SAP sales-order changes, EDI 855/865 change acknowledgements, customer communication.
8. **Impact:** avoided penalties, protected margin, retained customers.
9. **Hard to copy:** being penalty-aware and shelf-life-aware at once is uncommon, but "allocation" is a known category.
10. **Demo:** high when chained to C1; medium on its own.
11. **Difficulty:** Medium.

### C5 · Cold-chain liability attribution & claims recovery
1. **Problem:** damage losses get written off because nobody can prove in time who caused them.
2. **Decision:** who is liable (grower pre-cool, packhouse, carrier, DC) and for how much; whether to file, settle or dispute.
3. **Why humans struggle:**
   - Evidence is scattered across telematics portals, BOL setpoints, inspection certificates and custody timestamps.
   - Every contract is different.
   - Claims have deadlines; US carrier claims fall under the Carmack Amendment, which allows at least 9 months to file.
4. **Data:** telemetry split by custody segment, handoff events, the BOL setpoint instruction, inspection certificates, contract clauses (temperature terms, caps), loss quantity.
5. **Reasoning:** attribute the thermal dose to custody segments; interpret the contract; weigh expected recovery against cost; judge whether the evidence is sufficient.
6. **Agents:** a Liability & Claims agent.
7. **Action:** carrier claim through the TMS or carrier API, grower deduction in SAP FI, insurance claim, evidence pack sent to the counterparty.
8. **Impact:** recovers money that is otherwise written off, turning a cost center into recovery.
9. **Hard to copy:** it needs custody-segmented telemetry, a contract model and reconciled evidence. Counterparty-verifiable evidence through Secure Data Sharing is especially hard to copy.
10. **Demo:** high. "Who pays," proven with evidence.
11. **Difficulty:** Medium-High.

### C6 · Retailer deduction / chargeback dispute
1. **Problem:** retailers deduct from payments for quality, shortage or lateness. Many deductions are invalid, but contesting them by hand isn't worth the cost.
2. **Decision:** accept or dispute each deduction, and with which evidence.
3. **Why humans struggle:** high volume, small amounts, evidence in many systems, and dispute windows.
4. **Data:** EDI 812/820 remittance and deduction codes, proof of delivery, receipt QC, telemetry at delivery, appointment logs, PACA good-delivery standards / USDA destination inspections.
5. **Reasoning:** match each deduction reason to evidence; estimate the chance of winning; weigh cost against benefit.
6. **Agents:** a Deductions agent (could share the liability reasoning of C5).
7. **Action:** dispute through the retailer portal or EDI, or accept and post a credit memo in SAP.
8. **Impact:** revenue recovered from invalid deductions.
9. **Hard to copy:** moderately. Deduction tools usually lack physical evidence from telemetry.
10. **Demo:** medium. It's paperwork-heavy.
11. **Difficulty:** Medium.

### C7 · Quality-adjusted grower settlement
1. **Problem:** growers are paid on weight or pool price, and quality loss is argued about afterwards.
2. **Decision:** the settlement for each lot: price, quality deductions, and how responsibility is split.
3. **Why humans struggle:** it means manually reconciling QC results, pre-cool performance, contract terms and pool pricing, which leads to disputes.
4. **Data:** QC inspections, pre-cool telemetry, pack-out, contracts, pool prices, custody.
5. **Reasoning:** decide how much quality loss is the grower's versus downstream; calculate the contract terms.
6. **Agents:** a Settlement agent, or part of C5.
7. **Action:** vendor settlement or credit in SAP, grower statement.
8. **Impact:** fair pay, fewer disputes, no overpaying for poor quality.
9. **Hard to copy:** medium.
10. **Demo:** medium. It's the baseline's Demo 2, upgraded.
11. **Difficulty:** Medium.

### C8 · Evidence reconciliation: documents vs sensor truth
1. **Problem:** certificates, BOLs and receiving reports are trusted at face value even when they contradict the sensors.
2. **Decision:** which evidence to trust, and whether to re-inspect, reject, or escalate a quality or fraud issue.
3. **Why humans struggle:** reading PDFs and cross-checking telemetry is slow, and the discrepancies are subtle.
4. **Data:** PDFs read with AI_EXTRACT, telemetry, custody, shelf-life model, inspector and lab history.
5. **Reasoning:** extraction plus physical-consistency checks (e.g. the certificate says 1 °C at loading but the probe history says 4 °C); credibility scoring.
6. **Agents:** an Evidence agent for judging conflicts.
7. **Action:** QM re-inspection lot, hold, supplier corrective action.
8. **Impact:** claims that hold up, fewer wrongful acceptances or rejections, fraud detection.
9. **Hard to copy:** extracting fields from documents is a commodity; checking them against physics is not.
10. **Demo:** medium-high: "the PDF was wrong."
11. **Difficulty:** Medium.

### C9 · Precision recall scoping via lot genealogy
1. **Problem:** a contamination or residue finding forces a recall, and without precise genealogy companies recall too much.
2. **Decision:** the minimum recall scope (which lots, pallets, shipments and customers), plus holds and notices.
3. **Why humans struggle:** genealogy is spread across systems, the time pressure is measured in hours, and lots get commingled at the packhouse.
4. **Data:** the genealogy chain (block → harvest → pack → pallet → shipment → customer), lab results, inventory positions.
5. **Reasoning:** tracing the lot's links forward and backward, with uncertainty about commingling; regulatory reporting.
6. **Agents:** a Recall-scoping agent.
7. **Action:** SAP stock blocks, customer recall notices, regulator report.
8. **Impact:** lower recall cost (no over-recall), brand protection, compliance. It matches the PPT's "traceability" title.
9. **Hard to copy:** medium. Traceability vendors already exist.
10. **Demo:** high drama, but it isn't a real-time IoT story.
11. **Difficulty:** Medium.

### C10 · Organic-integrity mass balance & commingling detection
1. **Problem:** the organic premium is at risk when organic and conventional fruit commingle or volumes don't reconcile.
2. **Decision:** whether a lot can still be sold as organic, should be downgraded, or needs investigation.
3. **Why humans struggle:** mass balance is reconciled manually and only periodically, and fraud is subtle. USDA's Strengthening Organic Enforcement rule raised the bar.
4. **Data:** certifications, receipts and shipments by facility, pack-out, transaction certificates.
5. **Reasoning:** mass-balance anomaly detection; certificate validity.
6. **Agents:** a Compliance agent.
7. **Action:** downgrade to conventional, hold, notify the certifier.
8. **Impact:** protects the organic premium and avoids decertification.
9. **Hard to copy:** medium-high; it's domain-specific.
10. **Demo:** medium-low; there's no real-time drama.
11. **Difficulty:** Medium.

### C11 · Short-life DC inventory value recovery
1. **Problem:** stock at the DC near the end of its shelf life becomes waste.
2. **Decision:** when and where to discount, divert to a secondary channel (processor, foodservice) or donate.
3. **Why humans struggle:** many lots, a running shelf-life clock, and changing channel prices.
4. **Data:** DC inventory with remaining shelf life, demand, channel prices and capacity, donation partners.
5. **Reasoning:** maximize value over time as shelf life declines.
6. **Agents:** a Value-recovery agent (overlaps with C1 for stock already at the DC).
7. **Action:** SAP sales order to a secondary channel, price change, donation order.
8. **Impact:** less waste, recovered revenue, food-waste ESG reporting.
9. **Hard to copy:** low-medium; markdown optimization is well established in retail.
10. **Demo:** medium.
11. **Difficulty:** Low-Medium.

### C12 · Thermal-risk-priced carrier & lane selection
1. **Problem:** freight is bought on rate, so carriers' thermal performance (and the shrink they cause) is invisible when loads are tendered.
2. **Decision:** which carrier, lane and equipment for each load.
3. **Why humans struggle:** it needs per-carrier, per-lane, per-season excursion and claim history, so people default to the lowest rate.
4. **Data:** historical telemetry by carrier and lane, claims history, rates, transit times.
5. **Reasoning:** risk-adjusted total cost = freight + expected shrink − expected recovery.
6. **Agents:** a Freight agent. The need is weak because the scoring is deterministic.
7. **Action:** TMS tender.
8. **Impact:** lower total landed cost.
9. **Hard to copy:** the per-carrier thermal history is a data moat.
10. **Demo:** low-medium.
11. **Difficulty:** Medium.

### C13 · Harvest scheduling vs demand & heat
1. **Problem:** harvesting too much (or into a heat wave) creates shrink; harvesting too little shorts customers.
2. **Decision:** which blocks to pick tomorrow, how much, and when.
3. **Why humans struggle:** ripeness, weather, labor, cooler capacity and orders all have to be balanced.
4. **Data:** block yield and ripeness, weather forecasts, labor, cooler capacity, orders.
5. **Reasoning:** forecasting plus scheduling optimization.
6. **Agents:** a Harvest-planning agent.
7. **Action:** SAP PP harvest orders, crew scheduling.
8. **Impact:** less shrink and lower labor cost.
9. **Hard to copy:** medium.
10. **Demo:** low-medium; the cadence is slow.
11. **Difficulty:** High (credible forecasts).

### C14 · Pre-cooling queue & field-heat orchestration
1. **Problem:** delay between harvest and forced-air cooling burns shelf life.
2. **Decision:** the cooling order of pallets and the truck loading sequence.
3. **Why humans struggle:** real-time queueing under capacity limits.
4. **Data:** harvest timestamps, pulp temperatures, cooler capacity, departure times.
5. **Reasoning:** scheduling.
6. **Agents:** weak case; it's pure scheduling.
7. **Action:** cooler and WM work orders.
8. **Impact:** shelf life preserved at the source.
9. **Hard to copy:** low-medium.
10. **Demo:** low-medium.
11. **Difficulty:** Medium.

### C15 · Weekly volume commitments under yield uncertainty
1. **Problem:** committing too much volume earns penalties; committing too little forces sales at spot prices.
2. **Decision:** committed volume per customer per week.
3. **Why humans struggle:** uncertainty across many customers and prices.
4. **Data:** yield forecasts, weather, order history, contracts, spot prices.
5. **Reasoning:** optimization under uncertainty.
6. **Agents:** a Commercial-planning agent.
7. **Action:** SAP contract and scheduling-agreement updates.
8. **Impact:** high.
9. **Hard to copy:** medium.
10. **Demo:** low; the cadence is weekly.
11. **Difficulty:** High.

### C16 · Spot sourcing vs shorting
1. **Problem:** when supply is short, spot buying is decided ad hoc.
2. **Decision:** buy replacement fruit (from whom, at what price) or short the customer.
3. **Why humans struggle:** offers, supplier quality and thermal history, transit times, penalties and margins must all be weighed in minutes.
4. **Data:** supplier offers and prices, supplier quality and thermal history, transit times, penalties.
5. **Reasoning:** economic comparison plus supplier risk.
6. **Agents:** a Procurement agent.
7. **Action:** SAP PO.
8. **Impact:** margin vs penalty trade-off.
9. **Hard to copy:** low-medium.
10. **Demo:** medium (when chained to C4).
11. **Difficulty:** Medium.

### C17 · Exception triage by "decision deadline"
1. **Problem:** many simultaneous exceptions get worked first-in-first-out or by noise, while the best options quietly expire (e.g. the re-route window closes).
2. **Decision:** what to act on first, what to auto-handle, and what to escalate to whom.
3. **Why humans struggle:** alert fatigue, and nobody tracks when each option stops being possible.
4. **Data:** every open incident, its value at risk, and when each option expires.
5. **Reasoning:** compute each option's deadline and the value at risk; prioritize.
6. **Agents:** none needed. It's deterministic triage and cuts across the other candidates.
7. **Action:** assign, escalate, auto-handle.
8. **Impact:** faster response, avoided losses.
9. **Hard to copy:** the "decision deadline" concept is distinctive; triage itself is generic.
10. **Demo:** medium-high (visible clocks).
11. **Difficulty:** Low-Medium.

### C18 · Cold-room energy vs quality setpoints
1. **Problem:** cold rooms run at fixed setpoints regardless of tariff or product.
2. **Decision:** the setpoint schedule.
3. **Why humans struggle:** it's continuous control.
4. **Data:** tariffs, room telemetry, inventory.
5. **Reasoning:** control optimization.
6. **Agents:** an LLM isn't needed.
7. **Action:** building-management (BMS) setpoint change.
8. **Impact:** energy cost.
9. **Hard to copy:** low.
10. **Demo:** low.
11. **Difficulty:** High.

## Ranking (D × BV × TF × DI)

| Rank | Candidate | D | BV | TF | DI | Score | Fit /9 | Specific Snowflake leverage |
|---|---|---|---|---|---|---|---|---|
| 1 | C1 Excursion disposition & value recovery | 4 | 5 | 4 | 5 | **400** | 9 | Shelf life from streaming telemetry (DTs); governed specs and prices; Cortex reasoning next to the data |
| 2 | C5 Liability attribution & claims recovery | 5 | 5 | 3 | 4 | **300** | 9 | Custody-segmented telemetry; contracts joined to evidence; Secure Data Sharing with the counterparty |
| 3 | C8 Documents vs sensor-truth reconciliation | 4 | 4 | 4 | 4 | **256** | 9 | AI_EXTRACT on staged PDFs joined to telemetry in place |
| 4= | C2 Predictive reefer intervention | 4 | 4 | 3 | 5 | **240** | 9 | High-volume telematics; anomaly detection in-platform |
| 4= | C9 Precision recall scoping | 3 | 5 | 4 | 4 | **240** | 8 (not real-time) | Genealogy graph across SAP and packhouse data |
| 4= | C17 Decision-deadline triage | 4 | 3 | 5 | 4 | **240** | 8 (no agent) | Deadlines that stay current as data arrives (DTs) |
| 7 | C4 Penalty-aware re-promise | 3 | 4 | 4 | 4 | **192** | 9 | Quality-adjusted ATP (semi-additive) plus contracts |
| 8 | C3 Shelf-life-aware allocation | 3 | 5 | 4 | 3 | **180** | 8 (thin agent) | Optimization solver run inside Snowflake (Snowpark) |
| 9= | C6 Deduction dispute | 3 | 4 | 4 | 3 | **144** | 9 | EDI + POD + telemetry evidence in one place |
| 9= | C7 Quality-adjusted grower settlement | 3 | 4 | 4 | 3 | **144** | 8 (not real-time) | Thermal history linked to settlement |
| 11= | C10 Organic mass balance | 4 | 3 | 3 | 2 | **72** | 7 (not real-time, weak agent) | Cross-facility reconciliation |
| 11= | C11 Short-life value recovery | 2 | 3 | 4 | 3 | **72** | 8 (weak agent) | Inventory with remaining shelf life |
| 11= | C12 Thermal-risk carrier selection | 3 | 4 | 3 | 2 | **72** | 7 (weak agent, not real-time) | Per-carrier thermal history |
| 14 | C16 Spot sourcing vs shorting | 2 | 3 | 3 | 3 | **54** | 8 (little Snowflake leverage) | — |
| 15 | C14 Pre-cooling queue | 2 | 3 | 3 | 2 | **36** | 7 (no agent, single function) | — |
| 16 | C13 Harvest scheduling | 2 | 4 | 2 | 2 | **32** | 8 (not real-time) | — |
| 17 | C15 Volume commitments | 3 | 5 | 2 | 1 | **30** | 7 (not real-time, outside demo context) | — |
| 18 | C18 Energy setpoints | 2 | 2 | 2 | 1 | **8** | 5 (no agent, single function, outside context) | — |

## Observations (no winner selected)
- The top candidates aren't independent. C2 → C1 → C4/C3 → C5/C6/C7 are the **successive stages of one excursion lifecycle**. C8 supplies evidence to C1, C5 and C6, and C17 cuts across all of them.
- C5 has the **highest differentiation** (5) but its feasibility score is lower, because credible contract and custody modeling takes time.
- C17 is the cheapest to build and very demo-friendly, but it needs no agent, so on its own it fails the "meaningful agent" test.
- C3 and C4 are valuable, but "allocation" is a known category. Their differentiation depends on being both shelf-life-aware and penalty-aware.
- The low-ranked group (C13–C18) fails mainly on demo impact, need for an agent, or feasibility within 2 weeks.
- **Sensitivity:**
  - If C5's feasibility rises to 4 (e.g. with simplified contract terms), it scores **400** and ties C1.
  - If C2's anomaly model proves credible on simulator data (TF 4), it scores **320**.

---

# Phase 4 — Competitive Simulation (100 Snowflake AI submissions)

**Prevalence scale.** "≈ teams" is a simulated judgment estimate of how many of 100 submissions would build the typical version. It is not data.

| Class | Meaning |
|---|---|
| Very common | More than 10 teams |
| Common | 4–10 teams |
| Moderately differentiated | 2–3 teams, or a common theme with a distinctive twist |
| Highly differentiated | At most 1 team; needs domain depth |
| Extremely differentiated | About 0 teams; needs domain depth, a Snowflake-specific mechanism and a hard data model |

## All 18 candidates: what rival teams would build, classification, and elimination verdict

| # | Concept | What a typical team builds (≈ teams /100) | Class | Verdict |
|---|---|---|---|---|
| C1 | Excursion disposition | Temperature dashboard + threshold alert + "ask the agent", and the LLM says "hold and notify QA" (5–10) | Moderately (common theme; pricing the shelf-life loss is rare) | **Survives**, but only if it's decision economics, not alerting |
| C2 | Predictive reefer intervention | IoT predictive-maintenance anomaly model + alert feed (10–15) | Very common | ✗ generic anomaly detection |
| C3 | Shelf-life allocation | "AI recommends which lot to ship" (3–5) | Common | ✗ generic recommendation |
| C4 | Re-promise under supply shock | A "supply-chain disruption" multi-agent: detect → re-plan → notify. The archetypal supply-chain agent demo (10+) | Very common | ✗ generic multi-agent orchestration / recommendation |
| C5 | Liability attribution & claims recovery | Rarely attempted. If it is: a RAG "claims assistant" over contracts and BOLs (0–1) | **Extremely** | **Survives** |
| C6 | Deduction dispute | A deduction-code classifier + RAG over retailer policy docs (1–2) | Moderately (a known enterprise category: deduction-management software) | **Survives** |
| C7 | Quality-adjusted grower settlement | Settlement / invoice calculation + PDFs, i.e. the baseline's Demo 2 (5–8 in invoice automation broadly) | Moderately | **Survives** (narrowly: deterministic core) |
| C8 | Documents vs sensor truth | Document AI / AI_EXTRACT + "chat with your PDFs" over Cortex Search (15–25 for the typical version) | **Highly** in our framing; very common in theirs | **Survives**, only as reconciliation, never as extraction / RAG |
| C9 | Precision recall scoping | "Trace lot → customers" lineage query + chatbot, the farm-to-fork / blockchain-era trope (4–6) | Common | ✗ simple SQL / graph lookup + chatbot |
| C10 | Organic mass balance | Rare; the typical version is a mass-balance anomaly flag (0–1) | Moderately | ✗ generic anomaly detection |
| C11 | Short-life value recovery | Markdown / waste-reduction recommender (3–5) | Common | ✗ generic recommendation |
| C12 | Thermal-risk carrier selection | Carrier scorecard dashboard (2–4) | Common | ✗ dashboard / recommendation |
| C13 | Harvest scheduling | Yield / demand forecasting (10–15) | Very common | ✗ generic forecasting |
| C14 | Pre-cooling queue | Scheduler (1–2) | Moderately | ✗ no meaningful agent (generic optimization) |
| C15 | Volume commitments | Forecast + plan (3–5) | Common | ✗ generic forecasting |
| C16 | Spot sourcing | "Procurement agent recommends a supplier" (5–8) | Common | ✗ generic recommendation |
| C17 | Decision-deadline triage | Alert-prioritization dashboard (5–8) | Moderately | ✗ dashboard; no agent |
| C18 | Energy setpoints | Energy optimization / forecast (3–5) | Common | ✗ generic forecasting / optimization |

**Eliminated as standalone concepts, but with reusable parts:**
- C2's early-warning signal (an upstream trigger).
- C17's "decision deadline" (when an option stops being feasible).
- C3/C4's solver (a component, not a concept).
- C9's genealogy (a data model).

## The 5 survivors: competitive analysis

### C1 · Excursion disposition & value recovery: *Moderately differentiated*
1. **What a typical team builds:** an alert dashboard; the LLM says "hold and notify."
2. **What we could do differently:**
   - Treat the excursion as a **shelf-life loss to be priced**, not a compliance flag.
   - Compute remaining shelf life from thermal history.
   - Generate options that are feasible against every open order's spec and transit time, priced in dollars.
   - Decide before the re-route window closes, then execute under policy.
3. **Memorable demo moment:**
   - A judge triggers a reefer failure live.
   - Two clocks appear: shelf life remaining and "re-route window closes in 2h 10m."
   - The system re-routes the lot to a customer whose spec it still meets.
4. **Instant value for judges:** "Default hold = $47k write-off. Our decision = $41k recovered." One comparison, computed by the model.
5. **Hard to reproduce:** a variety-calibrated shelf-life model; a feasibility matrix of customer spec × transit time; economic option generation; a simulator where outcomes emerge rather than being scripted.
6. **Snowflake-specific story:**
   - Incremental Dynamic Tables accumulate thermal dose; a sum of Q10 terms can be maintained incrementally.
   - **ASOF JOIN** maps each reading to the lot or pallet assigned to that sensor at that moment.
   - The semantic view defines "remaining shelf life" once, for both rules and agent.
   - A Snowpark scorer runs next to the data.
   - The Cortex Agent is called only on escalated cases.

### C5 · Liability attribution & claims recovery: *Extremely differentiated*
1. **What a typical team builds:** almost nobody attempts it. The rare attempt is RAG over contracts: "is the carrier liable?"
2. **What we could do differently:**
   - Split the temperature trace by **custody segment** (who held the lot each minute) and attribute the damage to each segment.
   - Evaluate contract clauses (the BOL setpoint instruction, temperature terms, caps, filing deadlines) and quantify the loss.
   - Use the agent only for contested or multi-party cases.
   - Actions: carrier claim, SAP deduction, evidence pack.
3. **Memorable demo moment:**
   - One temperature chart, color-banded by custody (grower | carrier | DC), with the excursion inside the carrier's band.
   - "Claim filed: $X. Deadline in 270 days. Evidence attached."
   - Then the **carrier's own view** of the same evidence shows identical numbers.
4. **Instant value for judges:** "This loss was going to be written off; it's now a claim backed by proof."
5. **Hard to reproduce:**
   - It needs domain knowledge (carrier-claims law under the Carmack Amendment, BOL setpoints, PACA).
   - It needs a custody-event model, a clause model and attribution logic.
   - It needs a mechanism for sharing with the counterparty.
6. **Snowflake-specific story:**
   - **ASOF JOIN** of telemetry to custody handoffs.
   - **Secure Data Sharing** (or reader accounts for parties without Snowflake) gives the counterparty a verifiable read-only slice.
   - **Row access policies** show each party only its own shipments.
   - Time Travel / zero-copy clone keep the evidence immutable.
   - *Feasibility risk:* sharing and reader accounts on a trial account must be verified.

### C8 · Documents vs sensor truth: *Highly differentiated (in our framing)*
1. **What a typical team builds:** AI_EXTRACT / Document AI plus chat-with-PDFs. This is the most crowded pattern in the field.
2. **What we could do differently:**
   - Extraction is only step one.
   - Every extracted *claim* (pulp temperature at loading, inspection time, defect %) is checked against the physical record: sensor traces, custody times, cooling-rate physics.
   - The result is a consistency verdict and a credibility score; a contradiction triggers re-inspection or changes liability.
3. **Memorable demo moment:**
   - The certificate says "1.0 °C at 06:40"; the probe says 4.2 °C at 06:40.
   - A red contradiction badge appears, and the system refuses the certificate as evidence.
4. **Instant value for judges:** "The paperwork said fine. The sensors said otherwise. We caught it."
5. **Hard to reproduce:** aligning document claims to time series; physical-plausibility rules (pulp can't fall 3 °C in 10 minutes); credibility history per inspector and facility.
6. **Snowflake-specific story:**
   - A document pipeline entirely inside Snowflake: stage → directory table → stream → task → AI_EXTRACT.
   - **ASOF JOIN** of document timestamps to telemetry.
   - Documents never leave the platform.

### C6 · Retailer deduction dispute: *Moderately differentiated*
1. **What a typical team builds:** a deduction-code classifier plus RAG over retailer policies.
2. **What we could do differently:**
   - Tie each EDI 812 deduction to physical delivery evidence: arrival pulp temperature, appointment time vs dock time, POD quantities, the destination inspection vs PACA good-delivery tolerance.
   - Decide dispute or accept based on expected recovery.
   - Assemble the dispute package automatically.
3. **Memorable demo moment:** "The retailer deducted $6,200 for 'temperature abuse.' The fruit arrived at 1.2 °C and then sat 3 h at *their* dock. Dispute filed."
4. **Instant value for judges:** recovered revenue. Deductions are a familiar CFO pain in produce.
5. **Hard to reproduce:** EDI deduction semantics, appointment data and physical evidence, all joined together.
6. **Snowflake-specific story:** EDI as VARIANT, financial documents joined to telemetry in one governed platform, ASOF JOIN of dock events. A medium-strength story.

### C7 · Quality-adjusted grower settlement: *Moderately differentiated*
1. **What a typical team builds:** a settlement calculation plus PDFs (the baseline's Demo 2).
2. **What we could do differently:**
   - Deduct only for quality loss that happened in the **grower's custody** (pre-cool delay, pulp temperature at handoff).
   - Don't deduct for downstream damage.
   - Issue an evidence-backed statement the grower can contest.
3. **Memorable demo moment:** two growers with the same shrink at the DC. One is deducted (a 5 h pre-cool delay); the other isn't (a carrier failure). Fairness is visible.
4. **Instant value for judges:** fewer disputes and better grower relations.
5. **Hard to reproduce:** it shares C5's attribution engine. That makes it hard to copy, but not independent of C5.
6. **Snowflake-specific story:** as for C5, plus a share to the grower. A moderate story.

## Top 5 remaining concepts

| Rank | Concept | Class | Phase-3 score | Core value | Key risk |
|---|---|---|---|---|---|
| 1 | **C1 Excursion disposition & value recovery** | Moderately | 400 | Value recovered vs the default hold | Becomes a generic alert demo if the economic framing is weak |
| 2 | **C5 Liability attribution & claims recovery** | Extremely | 300 | Losses turned into evidence-backed claims | Credible contract / custody modeling; data sharing on a trial account |
| 3 | **C8 Documents vs sensor truth** | Highly | 256 | Paperwork that's wrong gets caught | Falls into extraction / RAG territory if reconciliation is shallow |
| 4 | **C6 Retailer deduction dispute** | Moderately | 144 | Invalid deductions recovered | Paperwork-heavy demo |
| 5 | **C7 Quality-adjusted grower settlement** | Moderately | 144 | Fair, evidence-based deductions | Deterministic core; overlaps C5 |

**Observations (no selection):**
- **C5, C6 and C7 are one capability**, custody-segmented attribution, applied to three counterparties: carrier, retailer and grower.
- **C8 supplies the evidence** that all four other concepts depend on.
- **C1 is the only survivor that makes a physical decision**; the others decide who pays.
- **The Snowflake mechanisms that rival teams are unlikely to use** recur across the survivors:
  - ASOF JOIN;
  - incremental thermal-dose Dynamic Tables;
  - Secure Data Sharing with counterparties, plus row access policies;
  - an in-platform document pipeline;
  - Time Travel / zero-copy clone for proof.

---

# Phase 5 — Frozen Product Concept: **Excursion Value Recovery**

## Selection (frozen)
- **C1 (excursion disposition)** and **C5 (liability & claims recovery)** form one product.
- **C8 (documents vs sensor truth)** is the evidence check inside it, not a separate feature.
- **Why this is one question and not two:**
  - Physical recovery and financial recovery are the two halves of *the same loss*.
  - Freight-claim practice expects the shipper to *mitigate* the loss: salvage value is deducted from the claim.
  - So the disposition decision directly decides the claim, and the claim depends on the disposition being defensible.
- **Excluded:**
  - C6 (retailer deductions), which has a different trigger.
  - C7 (general grower settlement); only a grower deduction that comes out of this case is kept.
  - Every idea eliminated in Phase 4.

## Core business question
**Executive form**, asked by the VP Supply Chain / Quality and the CFO:
> **"When a shipment breaks the cold chain, how much of its value can we still save, and who pays for the rest?"**

**Formal form:**
> For every compromised lot, which combination of **disposition**, **order recovery** and **financial recovery** maximizes **Net Recovered Value**, while staying within food-safety rules, customer specs, contracts and decision rights, *before the window to act closes*?

## Definitions

**1. Core business question.** As stated above. The single measure of success is **Net Recovered Value (NRV)** compared with the default action.

**2. Triggering event.** A **cold-chain excursion** on a lot in anyone's custody (packhouse, carrier, DC):
- product temperature stays above the variety's threshold for longer than the allowed tolerance, **or**
- the accumulated heat exposure uses up more than a set share of the lot's remaining shelf life.

Threshold, tolerance and share are versioned policy parameters, not code.

**3. State before the event.**
- The lot is in the custody of a known party and assigned to one or more sales-order lines.
- Each customer has a spec (minimum remaining shelf life at receipt, maximum arrival temperature).
- The ETA is planned, predicted shelf life at arrival meets the spec, and the lot is valued at contract price and counted in available stock.
- No claim exists.

**4. State after the event (decision required).**
- Remaining shelf life has fallen by Δ, so the current order may no longer meet its spec at the ETA.
- Value is at risk.
- The heat exposure can be attributed to the custody segment(s) where it happened.
- Evidence may conflict (documents vs sensors).
- A **decision deadline** exists: the time at which each option stops being feasible (re-route junction passed, shelf life below the next customer's spec).

**5. Decisions available.** Three linked choices, made together as one decision bundle:
- **A. Disposition (per lot):**
  - CONTINUE;
  - EXPEDITE;
  - RE-ROUTE to another customer or DC whose spec and transit time are still met;
  - DOWNGRADE to a processor or foodservice buyer;
  - INSPECT (hold for QC; this buys information at a cost and a delay);
  - REJECT (dispose or donate).
- **B. Order recovery** (only for order lines this case affects): keep, fill from an alternative lot, partial fill, or re-promise the date.
- **C. Financial recovery:** FILE CARRIER CLAIM, CHARGE GROWER (as the contract allows), ABSORB (own fault, or below the claim minimum), or DEFER (evidence insufficient, so collect more).

**6. Constraints.**
- **Food safety:** hard limits that no one can override.
- **Customer spec:** minimum remaining shelf life at receipt; maximum arrival temperature.
- **Transit feasibility:** destination reachable while shelf life still meets its spec; capacity available.
- **Organic integrity:** organic can be sold as conventional, never the reverse.
- **Contracts:**
  - Carrier liability requires a temperature instruction on the bill of lading (BOL).
  - Liability caps apply.
  - Claim filing deadlines apply; US carrier law (Carmack) allows at least 9 months.
  - Grower pre-cool clauses apply.
- **Decision rights:** who can authorize which action, at what value.
- **Decision deadline.**
- **Evidence sufficiency:** a minimum standard before any claim or deduction is filed.

**7. Objectives.**
- **Primary:** maximize NRV.
  - NRV = realized sale value after disposition + expected claim/deduction recovery − incremental costs (freight, re-route, inspection, disposal) − customer penalties on affected lines.
- **Secondary:**
  - protect strategic-customer service levels;
  - decide before the deadline;
  - zero food-safety violations;
  - zero policy violations.

**8. Risks.**

| Risk | What could go wrong |
|---|---|
| Model | Shelf-life prediction error, so a re-routed lot is rejected at receipt |
| Evidence | A sensor fails or is misplaced, or the documents are wrong, so liability is attributed to the wrong party |
| Commercial | Re-promising harms a strategic account |
| Legal | A wrongful claim; a missed filing deadline; a weak claim because the loss wasn't mitigated |
| Food safety | Compromised product gets shipped |
| Automation | Acting on stale data; duplicate actions; AI error |
| Timing | Waiting for an approval past the deadline |

**9. Financial consequences.** Illustrative, using the baseline's scale: a 4,200 kg organic lot at $11.20/kg = **$47,040**. Other prices are labelled assumptions.

| Option | Realized value | Costs | Claim recovery | Net position |
|---|---|---|---|---|
| Default: continue → rejected at receipt | $0 | Return / disposal freight | Full loss claimed, but contested ("failure to mitigate"); assume ~50% | ≈ **$23.5k** expected, minus freight |
| Hold → reject now | $0 | Disposal | Same as above | ≈ $23.5k expected, minus disposal |
| **Re-route** to a regional customer 6 h away, 5-day spec, 95% price (assumption) | $44,688 | Re-route $1,200 (assumed) + replacement handling for the original order $400 (assumed) | Residual loss $3,952 × p≈0.8 ≈ $3.2k | ≈ **$46.2k** (≈98% of plan) |
| Downgrade to processor at $3.50/kg (assumption) | $14,700 | Freight $600 (assumed) | Claim on the $32.9k residual | ≈ $14.1k + claim |

**The decision is worth about $23k on one lot.** The default loses half the value; the recovery decision keeps about 98%.

**10. Final action.** One executed **decision bundle**:
- **Physical:** re-route instruction to the carrier, or a stock block (hold), or a processor sales order.
- **Order:** replacement-lot assignment, or a re-promise notice to the affected customer.
- **Financial:** a carrier claim filed with its evidence pack, or a grower deduction posted, or the absorption booked.
- **Record:** the case moves to awaiting outcome.

**11. Human approval conditions.** These are policy data; the values below are example defaults.
- **Auto** only when all of these hold:
  - the recommendation is rule-decided (one option clearly dominates);
  - value at risk < $10k;
  - no tier-A customer is shorted or delayed;
  - no food-safety flag;
  - autonomy mode is AUTO.
- **Quality manager:** any REJECT, or any override of an INSPECT recommendation.
- **Sales manager:** any short or delay of a tier-A order; any re-route to a different customer above $25k.
- **Finance:** any carrier claim, grower deduction or absorption above $10k.
- **AI-chosen recommendation above $10k:** always needs approval. The AI never self-executes above that threshold.
- **Always:**
  - the proposer is not the approver;
  - the approver holds the required role;
  - the approval is void if the evidence changed beyond tolerance since the proposal;
  - the approval must arrive before the deadline, otherwise the **safe fallback** (INSPECT/hold) executes and the case escalates.
- **Shadow mode:** everything is recorded and nothing executes.

**12. Expected outcome.**
- **Per case:**
  - decided before the deadline;
  - NRV ≥ the default action's value;
  - every action acknowledged by the system of record;
  - any claim filed within its deadline;
  - the real outcome measured: receipt QC vs predicted shelf life, actual sale, claim result;
  - the case sealed with a verified record.
- **Product-level measures:**
  - NRV recovered vs default;
  - time from event to decision;
  - share of cases decided by rule / AI / human;
  - approval latency;
  - shelf-life prediction error;
  - claim recovery rate;
  - policy violations = 0;
  - food-safety violations = 0.

## The decision lifecycle: the core of the product

The central object is the **Recovery Case**. Every stage reads the previous stage's record and writes its own **immutable record**.

| Stage | Question it answers | Performed by | Output record | Moves on when | If it fails |
|---|---|---|---|---|---|
| **EVENT** | What physically happened? | The world: sensors, custody handoffs | Readings, custody events | — | Sensor gaps are recorded as facts |
| **DETECTION** | Is this an excursion that needs a decision? | Rules (versioned thresholds) | **Case opened**: lots, onset time, custody holder, severity | Threshold × tolerance met; one case per load | Data gap → case opened as "evidence gap" |
| **UNDERSTANDING** | How much shelf life was lost? What's at risk? Who held it? Can we trust the evidence? | Deterministic models. **AI only to judge conflicting evidence** | **Situation Assessment** (sealed evidence pack): remaining shelf life, heat exposure by custody segment, affected orders, value at risk, decision deadline, evidence conflicts | Assessment complete | Gaps flagged; INSPECT becomes an option |
| **OPTIONS** | What could we do? | Deterministic generator | **Option Set**: disposition × destination × order recovery × financial recovery, with feasibility flags and expiry times. **Always includes the default action and the safe fallback** | At least one feasible option (the fallback always is) | None other than the fallback → fallback + escalate |
| **EVALUATION** | What is each option worth, and how sure are we? | Deterministic scorer | **Scored Options**: NRV components, penalties, rejection risk, claim-recovery probability, time-to-execute vs deadline; a dominance test; escalation reasons | Scoring complete | — |
| **RECOMMENDATION** | Which option, and why? | **Rule** if one option dominates and no escalation reason applies; **AI agent** otherwise | **Recommendation**: chosen option, rationale, cited evidence, rejected alternatives and why, decider identity and version, confidence | A valid choice from the scored set | Agent fails → rule fallback, flagged |
| **GOVERNANCE** | Is it allowed, and who must sign? | Deterministic policy (versioned) | **Policy Evaluation**: AUTO / APPROVAL (roles) / DENIED, with reasons and policy version | Result determined | DENIED → re-recommend under the added constraint, or fallback |
| **APPROVAL** | Does an accountable person agree? | A human holding the required role | **Approval**: identity, role, verdict (approve / pick another scored option / reject), reason, evidence-freshness check | Verdict recorded | Deadline reached → safe fallback + escalation |
| **EXECUTION** | Did the actions actually happen? | The system, against the systems of record | **Execution**: each action with its external reference and acknowledgement | All actions acknowledged | Retry → compensate; partial execution flagged |
| **OUTCOME** | What really happened? Was the decision right? | Observed facts: receipt QC, sale, claim result | **Outcome**: realized NRV vs predicted vs the default counterfactual; prediction error | Observed, or timed out | "Unknown" recorded explicitly |
| **AUDIT** | Can anyone (an auditor, the carrier) verify the whole chain? | Verification | **Sealed Case**: tamper-evident, replayable as of decision time, evidence pack exportable to the counterparty | Seal verified | Verification failure → alert, case reopened |

**Case states:**
- Main path: `OPEN → ASSESSED → OPTIONS_READY → EVALUATED → RECOMMENDED → (AUTO_APPROVED | PENDING_APPROVAL → APPROVED/REJECTED) → EXECUTING → EXECUTED → AWAITING_OUTCOME → OUTCOME_RECORDED → SEALED`
- Side exits: `FALLBACK_EXECUTED`, `DENIED`, `EXECUTION_FAILED (compensated)`, `SHADOW_RECORDED`.

## Lifecycle invariants (true for every case)
1. Nothing executes without a Governance record. Nothing that needs approval executes without an Approval record.
2. **AI is used at exactly two points:** judging conflicting evidence (Understanding) and choosing among options when none dominates (Recommendation). It never produces numbers, never evaluates policy, and never executes.
3. Every number comes from Evaluation. A recommendation can only pick from the scored set; any variant is re-scored first.
4. The **default action is always evaluated**, so value recovered is always measured against what would have happened anyway.
5. Every case has a decision deadline. If it's missed, the predefined safe fallback executes and is recorded.
6. Every stage writes an immutable record, and the chain is verifiable from EVENT to OUTCOME.
7. Food-safety hard rules can't be overridden by any role.
8. Thresholds, prices, specs, contracts and decision rights are versioned data, not code.

## Out of scope (frozen)
- A chat interface as the product.
- Dashboards beyond case views.
- Forecasting.
- Predictive maintenance.
- Retailer deduction disputes.
- General grower settlement.
- Recall.
- Harvest planning.
- A general allocation engine. Order recovery covers only lines affected by the case.

---

# Phase 6 — Agent System for Excursion Value Recovery

## Design rules
- An agent exists only where **judgment over unstructured, conflicting or unquantified information** is needed.
- Numbers, policy, orchestration and execution stay deterministic.
- Agents **never talk to each other**. They read and write case records, and the case state machine invokes them on explicit triggers.
- **Kill criterion:** every agent has a measurable condition under which it gets removed.

**Result: 4 agents.** A 5th or 6th candidate failed the "why not normal logic?" test (see the rejected list).

## Overview

| Agent | Lifecycle stage | Business owner | Why not normal application logic? | Strength |
|---|---|---|---|---|
| **1. Excursion Forensics** | UNDERSTANDING | Quality / cold-chain | Deciding the cause means weighing competing hypotheses across free-text notes, documents, sensor metadata and conflicting readings. Covering every combination with rules becomes an unmaintainable expert system, and rules can't read free text | **Strong** |
| **2. Recovery Strategist** | RECOMMENDATION (decision 1) | Quality + Sales | The scorer settles the trade-offs that can be quantified. What's left is account context, soft quality remarks, whether the shelf-life model is valid for this case, and how robust the choice is to prediction error. Approvers need that trade-off reasoned out | **Moderate** (kill criterion applies) |
| **3. Claims & Recovery** | Decision 1 (liability position, notice) + decision 2 (settlement, counterparty responses) | Finance | Amounts, caps and deadlines are deterministic. Arguing liability from clause text and evidence, checking prerequisites, anticipating defenses and assessing free-text denials are language-and-argument work | **Strong** |
| **4. Evidence Integrity Auditor** | Before APPROVAL and before any outbound send | Governance (no authority to decide) | Validators can check schema, that citations exist and that numbers match. They can't check whether a *sentence* is supported by the evidence it cites | **Moderate** (justified by legal exposure in outbound claims) |

## How the requested role areas map
- **Event intelligence → rejected.** Detection is thresholds plus known signatures (defrost cycles, door openings) on numeric time series.
- **Operational / quality intelligence →**
  - shelf life stays a deterministic model;
  - deciding the *cause* is Agent 1.
- **Recovery / optimization intelligence →**
  - optimization stays deterministic;
  - choosing when no option clearly wins is Agent 2.
- **Financial / commercial intelligence →**
  - Agent 3;
  - customer notices are templates.
- **Governance / execution intelligence →**
  - governance and execution stay deterministic;
  - Agent 4 supports governance without any decision authority.

## Agent cards

### 1 · Excursion Forensics Agent
- **Responsibility:** establish what caused the excursion, in whose custody it happened, and whether the evidence is trustworthy enough to act on and to claim.
- **Inputs:**
  - the Situation Assessment: heat exposure split by custody segment, remaining shelf life (both deterministic);
  - physical-consistency conflict flags;
  - extracted document fields plus raw text: inspection certificates, the bill of lading (BOL) setpoint instruction, receiving reports, driver and carrier incident notes, reefer download;
  - sensor metadata: placement, calibration.
- **Context** (a versioned cold-chain reference card):
  - reefers *maintain* temperature; they don't pull warm product down;
  - defrost and door events spike air temperature, not pulp temperature;
  - supply-air vs return-air semantics;
  - how probe placement affects readings;
  - pre-cooling norms;
  - how much weight each document type carries.
  - Data scope: this case only; precedents come only through a tool.
- **Reasoning:**
  1. Enumerate the possible causes: reefer malfunction, setpoint differing from the BOL instruction, warm loading / pre-cool failure, dock dwell, door events, sensor artifact.
  2. Test each against the evidence and rank them.
  3. Assign the responsible party, referencing the deterministic custody segments.
  4. Judge whether the evidence is sufficient for a claim.
  5. List gaps and what would close each one.
- **Tools:**
  - read-only: `get_assessment`, `get_telemetry_window`, `get_custody_timeline`, `get_documents`, `get_consistency_checks`, `get_sensor_metadata`, `get_precedents`;
  - one low-risk action: `request_evidence` (a governed action type, e.g. asking the carrier for the reefer download);
  - `submit_causation_finding`.
- **Outputs: Causation Finding**:
  - each hypothesis with its verdict;
  - the most likely cause;
  - the responsible party or parties;
  - a trust assessment for each evidence source;
  - SUFFICIENT / INSUFFICIENT for a claim;
  - gaps and requests;
  - confidence with reasons;
  - citations.
- **Decision authority:** sets the case's causation finding, which feeds OPTIONS and Claims; may issue evidence requests.
- **Restrictions:**
  - every assertion cites an evidence ID;
  - no facts beyond the evidence;
  - it can't change any number;
  - it can't decide the disposition or the claim.
- **Confidence:** HIGH/MED/LOW with mandatory reasons, capped by a deterministic **evidence-coverage score** (required evidence types present ÷ required).
- **Failure behavior:**
  - one retry with the validator's errors;
  - then fall back to deterministic attribution by custody, flagged `UNADJUDICATED`;
  - claims stay DEFERRED until a human reviews.
- **Escalation:**
  - **Invoked only** on a conflict flag, free-text evidence, or an ambiguous cause (no party holds more than 70% of the heat exposure, a warm-loading signal, or a setpoint different from the BOL).
  - **Escalates to the Quality manager** on LOW confidence or any sign the documents were falsified.
- **Audit:**
  - input snapshot hash;
  - tool calls with result hashes;
  - hypotheses and verdicts, citations;
  - model, provider and version; spec and reference-card version;
  - confidence, latency and cost;
  - the Auditor's verdict;
  - human edits.
- **Kill criterion:** if deterministic attribution matches the oracle cause (the known true cause in the eval set) as often as the agent does, remove the agent.

### 2 · Recovery Strategist Agent
- **Responsibility:** choose the **disposition + order-recovery** bundle from the scored options when rules can't decide.
- **Inputs:** Scored Options (NRV, penalties, rejection risk, expiry), the Situation Assessment, the Causation Finding, and the escalation reasons.
- **Context:** decision principles, all versioned:
  - maximize NRV;
  - respect the risk-appetite policy;
  - protect tier-A customers as policy says;
  - prefer *reversible* options (INSPECT over REJECT) when uncertainty is high and the deadline allows.
- **Reasoning:**
  1. Find the non-dominated set (options no other option beats on every measure).
  2. Test robustness by re-scoring variants with prediction error of ±X and alternative ETAs.
  3. Weigh the qualitative factors.
  4. Choose, and state what would change the choice.
- **Tools:**
  - `get_scored_options`;
  - `score_variant` (a deterministic what-if);
  - `get_customer_context`: tier, penalty clauses, recent incidents, account notes;
  - `get_precedents`, including their outcomes;
  - `get_model_validity`: whether the shelf-life model is calibrated for this cultivar and these conditions;
  - `submit_recommendation`.
- **Outputs: Recommendation**:
  - the chosen option ID;
  - rejected alternatives and why;
  - the trade-off statement;
  - the robustness result;
  - "would change if…";
  - confidence;
  - citations.
- **Decision authority:** select **one option from the scored set**, or a variant that has been re-scored. It can't execute or approve.
- **Restrictions:**
  - no numbers of its own;
  - it can't pick an infeasible or expired option;
  - it can't override food safety;
  - it must decide by the deadline minus the approval buffer;
  - any choice above $10k needs approval (policy).
- **Confidence:** HIGH/MED/LOW plus a **robustness flag** (does the choice stay stable across variants?). Unstable plus LOW means it recommends the reversible option or escalates.
- **Failure behavior:**
  - fall back to the scorer's top feasible option, flagged `AI_UNAVAILABLE`, which always needs approval;
  - if the deadline is near, the safe fallback runs.
- **Escalation:**
  - **Invoked only** when no option clearly wins, exposure is high, a tier-A customer is affected, the model is outside its validity range, or qualitative signals are present.
  - **Escalates** to the Sales manager (tier-A impact) or the Quality manager (reject / inspect conflicts) through governance.
- **Audit:** the standard set, plus the robustness variants and an explicit "**deviated from the top score because…**" whenever its choice differs from the scorer's.
- **Kill criterion:** if its choices don't beat "always pick the top NRV" on realized NRV in evals, remove it.

### 3 · Claims & Recovery Agent
- **Responsibility:** recover the loss that couldn't be mitigated from the responsible party, or decide to absorb it, with a claim that holds up.
- **Inputs:**
  - the Causation Finding;
  - the loss computation: planned value − realized salvage + incremental costs (deterministic);
  - contract terms: structured fields plus clause text;
  - claim rules: deadlines, minimums, required documents;
  - counterparty history;
  - counterparty responses.
- **Context:**
  - a freight-claim reference card: prompt notice, the carrier's opportunity to inspect, the duty to mitigate / salvage, required documents, the basics of the Carmack Amendment (US carrier-liability law);
  - grower-contract principles;
  - both versioned.
- **Reasoning:**
  1. Determine the basis: which clause, which party.
  2. Check the prerequisites: notice on time, mitigation evidenced, documents complete.
  3. Get claim variants (full, capped, settlement range) from a tool.
  4. Weigh expected recovery against cost and the relationship.
  5. Decide FILE / DEDUCT / ABSORB / DEFER.
  6. Draft the claim narrative, citing evidence.
  7. When a response arrives: classify the defense, test it against the evidence, recommend ACCEPT / COUNTER / APPEAL / ABSORB.
- **Tools:** `get_causation_finding`, `get_loss_computation`, `get_contract_terms`, `get_claim_rules`, `get_counterparty_history`, `score_claim_variant`, `assemble_evidence_pack` (deterministic), `get_counterparty_response`, `submit_claim_recommendation`.
- **Outputs: Claim Recommendation**:
  - action and party;
  - contractual / legal basis;
  - amount (from the tool);
  - prerequisites checklist;
  - anticipated defenses and rebuttals;
  - draft letter;
  - evidence-pack ID;
  - confidence.
- **Decision authority:** recommend and draft outbound text. Nothing is filed without governance, and amounts come only from calculator variants.
- **Restrictions:**
  - it can't file when Forensics confidence is LOW or evidence is INSUFFICIENT (it must DEFER);
  - the deadline guard is deterministic and independent of the agent;
  - outbound text must pass the Auditor;
  - settlement offers stay within the policy band.
- **Confidence:** HIGH/MED/LOW plus deterministic prerequisite completeness, plus the historical acceptance rate for similar claims (a deterministic statistic).
- **Failure behavior:** DEFER, and route the case with its assembled evidence pack to a human in Finance. The deadline guard keeps running regardless.
- **Escalation:**
  - **Invoked only** when external liability exists and the expected recovery is at least the claim minimum, or when a counterparty response arrives.
  - Otherwise the case is ABSORBed deterministically.
  - **Escalates** to Finance for any claim over $10k, and to legal counsel if a threshold is exceeded or litigation is signalled.
- **Audit:** the standard set, plus letter versions, the Auditor's verdicts and hashes of all counterparty correspondence.
- **Kill criterion:** if template claims achieve the same acceptance and recovery against simulated counterparty defenses, remove the drafting and rebuttal role.

### 4 · Evidence Integrity Auditor
- **Responsibility:** verify that every factual statement in an AI-written artifact is supported by the evidence it cites, and **block** anything that isn't.
- **Inputs:** the artifact (causation finding, recommendation rationale, claim letter, rebuttal), the cited evidence, and the case facts.
- **Context:** a strict verification rubric. It is independent of the author: **a different model or provider where policy allows**, which puts the pluggable LLM layer to real use.
- **Reasoning:** break the artifact into atomic claims, then classify each as SUPPORTED / UNSUPPORTED / CONTRADICTED. A number mismatch is checked deterministically first.
- **Tools:** `get_artifact`, `get_cited_evidence`, `get_case_facts`, `submit_audit_verdict`.
- **Outputs:** a verdict per claim, PASS/FAIL overall, and the fixes required.
- **Decision authority:** **veto** over artifacts. It can't edit content or change decisions.
- **Restrictions:** no drafting tools; it may not introduce new facts.
- **Confidence:** per claim. Any CONTRADICTED claim means FAIL.
- **Failure behavior:** **fail-closed.**
  - Outbound artifacts can't be sent if the auditor is unavailable.
  - Internal approvals proceed under an `UNVERIFIED` banner and need a human.
- **Escalation:** on FAIL, the artifact goes back to its author once with the required fixes; a second FAIL goes to a human.
- **Audit:** the verdicts, the model and its version, the artifact hash and the evidence hashes.
- **Kill criterion:** if deterministic checks catch every seeded faithfulness error in evals, remove it.

## Rejected agents

| Candidate | Why rejected | Handled instead by |
|---|---|---|
| Event intelligence / alert triage | Thresholds plus known signatures on numeric series. LLMs are poor at classifying numeric time series and add latency | Versioned detection rules + data-quality flags |
| Sensor / data-quality agent | Gaps, flatlines and drift are statistical checks | Deterministic checks; ambiguous cases go to Forensics |
| Shelf-life / quality agent | A physics model has to be reproducible | Shelf-life model |
| Option-generation agent | Enumerating options under constraints is combinatorial | Deterministic generator |
| Optimization / scoring agent | Numbers must be reproducible and auditable | Scorer + solver |
| Governance / policy agent | An LLM interpreting policy is a governance hole | Versioned policy engine |
| Execution agent | Idempotency, retries and compensation are engineering problems, not judgment | Executor + outbox |
| Customer-communication agent | Re-promise notices are factual; templates avoid AI making customer-facing commitments | Fact-filled templates |
| Approval-briefing agent | The recommendation already carries its rationale; a second summarizer adds risk | Recommendation output |
| Outcome / learning agent | Predicted vs actual is arithmetic; recalibration is an offline data-science process | Outcome tracker + offline calibration |
| Precedent / memory agent | Finding similar cases is a structured query | `get_precedents` tool |
| Supervisor / orchestrator | The lifecycle is a fixed state machine; LLM routing would make the process non-deterministic | Case state machine |

## Coordination model
- The deterministic **case state machine** is the only orchestrator.
- Agents are invoked on triggers.
- Each output goes through three steps in order:
  1. deterministic validation (schema, citations, numbers);
  2. the Auditor (for AI-written text);
  3. governance.
- **No agent can call another agent.**

## Amendments to Phase 5 (need your acceptance)
- **A1 · Two decision points per case:**
  - **D1 Recovery:** disposition + order recovery + liability position + **notice of claim**. Urgent, measured in hours.
  - **D2 Settlement:** claim filing / deduction / absorb, plus counterparty responses. This comes after the salvage outcome is known.
  - Both run OPTIONS → EXECUTION under the same governance.
  - *Reason:* freight-claim practice calls for prompt notice, and the claim amount is the loss that remains after mitigation.
- **A2 · Invariant #2 restated:** AI is used only for:
  1. causal judgment over conflicting or unstructured evidence;
  2. choosing among options when none clearly wins;
  3. claim argument and counterparty responses;
  4. verifying statements AI has written.
  
  It never produces numbers, evaluates policy or executes.

---

# Phase 7 — Architecture Boundary

## Placement criteria
| Category | Rule for placing a component here |
|---|---|
| **A. Must be in Snowflake** | Snowflake is the **system of record or the enforcement point**. Moving it out would break governance, audit or replay |
| **B. Should be in Snowflake** | Snowflake gives a clear advantage (next to the data, Cortex, reproducible), but a careful outside implementation would still be acceptable |
| **C. Application code** | Network protocols, external integrations, identity flows, orchestration that calls external services, user interaction |
| **D. AI agents** | Judgment over unstructured, conflicting or unquantified information |
| **E. Frontend** | Presentation and interaction only, with **zero business logic** |
| **F. External** | Systems we integrate with or simulate, but don't own |

**Note on "option evaluation":**
- The *quantitative* evaluation (NRV, risk, claim variants) is deterministic and sits in **B**.
- Agents (**D**) only do the *qualitative* weighing and explanation of options that no other option beats on every measure (non-dominated options).
- This keeps "every number comes from Evaluation" true.

## A. Must be in Snowflake
| ID | Component | Why |
|---|---|---|
| A1 | Raw landing tables (append-only telemetry, SAP documents, carrier events, EDI) | The source of all evidence. Replay "as of" any time depends on it |
| A2 | Master & reference data: customers + specs, contracts (structured terms **and** clause text), carriers, lanes, prices, shelf-life parameters, all versioned | Decisions depend on the exact version used, which has to be governed and joinable |
| A3 | Document store (stage + directory table) | Evidence documents must be immutable and governed next to the data they're checked against |
| A4 | Core transformations: telemetry cleaning, **sensor → pallet assignment (ASOF JOIN)**, custody segmentation | Evidence has to be reproducible from governed data |
| A5 | Dynamic state: thermal dose, remaining shelf life, exposure by custody segment (**incremental Dynamic Tables**) | One computation shared by rules, agents and UI ("same question, same answer") |
| A6 | Excursion detection + case opening (stream + task) | Event processing next to the data; it keeps working if the app is down |
| A7 | **Semantic view**: remaining shelf life, compliance, value at risk, NRV, recovery rate, decision KPIs | Every metric defined in one place |
| A8 | Case & lifecycle records (assessment, options, scores, recommendation, policy evaluation, approval, execution, outcome) | This is the decision evidence |
| A9 | Lifecycle guard: allowed state transitions and invariants, enforced in procedures | The app can't skip a stage |
| A10 | Policy engine: decision rights, autonomy mode, food-safety hard rules, thresholds | Enforcement can't live in the client |
| A11 | Approval enforcement: `CURRENT_USER()` identity, role check, proposer ≠ approver, staleness re-check | Identity must come from Snowflake authentication, not from what the app says |
| A12 | Execution commit: state change + outbox rows in **one transaction** | The action record must be atomic |
| A13 | Agent tool surface: read-only tool procedures + `SUBMIT_*` with server-side validation (schema, citations exist, numbers match the scored set), under a restricted agent role | Agent data access is governed; agents can't write directly |
| A14 | Hash-chained ledger, verification, as-of replay (Time Travel / zero-copy clone) | Audit |
| A15 | Roles, grants, masking and row access policies | Governance |

## B. Should be in Snowflake
| ID | Component | Why |
|---|---|---|
| B1 | Document extraction pipeline (directory-table stream → task → **AI_EXTRACT**) | Documents never leave the boundary; Cortex is built in |
| B2 | Contract-clause extraction when a contract is onboarded | Same reason |
| B3 | Physical-consistency checks (document claims vs sensor traces) and data-quality checks | They join documents to telemetry where both already live |
| B4 | Option generator | Needs governed orders, specs, lanes and inventory; replayable |
| B5 | Scorer (NRV, rejection risk, loss, claim variants) + replacement-lot solver (Snowpark Python) | Numbers are reproducible next to the data. App code with strict versioning would be acceptable, but harder to audit |
| B6 | Router (dominance test, escalation triggers; the rules themselves are versioned data) | Evaluated where the facts live; its output is recorded as evidence |
| B7 | Decision-deadline computation + **deadline watchdog task** | The safe fallback still fires if the app or the approvers miss the deadline |
| B8 | Outcome computation (realized vs predicted vs default) and KPIs | Analytical computation |
| B9 | Precedent query (historical decision memory over sealed cases) | A structured query over governed history |
| B10 | **Cortex Agents runtime** (the default provider) | Reasoning runs inside the governance boundary, and tools run under Snowflake roles. *Designed in D, hosted here* |
| B11 | Counterparty evidence sharing (Secure Data Sharing / reader account + row access policy) | Native, governed sharing. *Stretch goal: needs verifying on a trial account* |

## C. Application code
| ID | Component | Why |
|---|---|---|
| C1 | Connector SDK + connectors (IoT webhook/MQTT, SAP OData, carrier/TMS, files/EDI) + Snowflake sink | Protocols, external auth, retries, backpressure. No SPCS on trial; publishable OSS packages |
| C2 | **Lifecycle driver** (engine worker): claims work items, calls stage procedures, invokes agents, handles timeouts and retries | Has to call external LLMs and services. Stateless; all state lives in A |
| C3 | LLM provider adapters (cortex-agent by default; anthropic / openai-compatible) | Makes the LLM pluggable; requires external network calls |
| C4 | Outbox dispatchers: SAP actions, carrier notices and claims, customer notices; acks sent back through a procedure | External integrations |
| C5 | API layer (backend-for-frontend) | The UI never connects to Snowflake directly |
| C6 | Authentication + identity propagation (each user acts under their **own** Snowflake identity) | The app runs the login flow; Snowflake enforces (A11) |
| C7 | Session management | User interaction |
| C8 | Human notifications (approval requests, deadline warnings) | External channels |
| C9 | Rendering customer-notice templates | Deterministic text, with no AI in customer commitments |
| C10 | `bbc` CLI (deploy wrapper, simulate, verify, export proof, eval) + eval harness | Developer and ops tooling |
| C11 | Agent-spec compiler (YAML → Cortex Agent DDL + provider tool schemas) | One definition serves several runtimes |

## D. AI agents
| ID | Component | Why |
|---|---|---|
| D1 | Excursion Forensics | Judging cause from conflicting and free-text evidence |
| D2 | Recovery Strategist | Qualitative weighing and explanation of options when none dominates |
| D3 | Claims & Recovery | Building the liability argument; interpreting counterparty responses |
| D4 | Evidence Integrity Auditor | Checking that AI-written text is supported by its evidence |
| D5 | Agent specs, instructions and reference cards, all versioned | The agents' knowledge; the versions used are recorded in the ledger |

## E. Frontend
| ID | Component | Why |
|---|---|---|
| E1 | Case inbox, sorted by decision deadline × value at risk | Presentation |
| E2 | Case workspace: one panel per lifecycle stage, EVENT → AUDIT | Makes the lifecycle visible |
| E3 | Evidence views: temperature chart banded by custody; document-vs-sensor contradictions | Presentation |
| E4 | Options & recommendation view: scored options, the choice, rejected alternatives, a badge showing whether a rule or AI decided | Presentation |
| E5 | Approval actions: approve / choose another scored option / reject, with a reason | Interaction only; enforcement is in A11 |
| E6 | Proof view: verify the chain, replay as of the decision time, export the evidence pack | The trigger only; verification runs in A14 |
| E7 | Read-only view of the active policy and agent versions | Transparency, not editing |

## F. External
| ID | Component | Why |
|---|---|---|
| F1 | SAP S/4HANA (a mock in the demo) | The system of record for orders, stock and finance |
| F2 | Carrier / TMS systems (mock) | Custody events, re-routing, claims |
| F3 | Reefer and pallet sensors, telematics, MQTT broker | Device world |
| F4 | Document sources (inspectors, carrier portals) | Third parties |
| F5 | External LLM providers (only if the model registry allows them) | Optional and governed |
| F6 | Notification channels | Third party |
| F7 | Counterparties (carrier, grower) consuming shared evidence | They are the verifiers |
| F8 | **Simulator** (physics-based world + fault injection) | Plays the external world and feeds data **only through C1 connectors and F mocks** |

**Deliberately *not* in Snowflake:**
- **UI:** Streamlit can't provide the case workspace.
- **Connector runtimes, lifecycle driver, LLM adapters, notifications:** they need external network access and pluggability.
- **Mocks and simulator:** they're external by nature.
- **Snowflake Postgres:** dropped.
- **SPCS:** the future host for C and E once available; not on trial.
- **Snowflake Intelligence:** it isn't the product.

## Cross-boundary contracts
1. **App → Snowflake** goes only through:
   - RAW inserts (ingest role);
   - stage procedures (engine role);
   - user-context procedures (persona roles).
   
   **No app role has DML on decision or ledger tables.**
2. **Agents → Snowflake** goes only through tool procedures under the agent role. Writes happen only through `SUBMIT_*`.
3. **Frontend → API only.** No Snowflake credentials ever reach the browser.
4. **Snowflake → external** goes only through the OUTBOX, read by the dispatchers; acks come back through a procedure.
5. **One decision contract:** JSON Schemas for every lifecycle record, shared by the app (TypeScript) and the procedures (Python).

## Who builds what: Claude vs CoCo
| Work | Builder | Why |
|---|---|---|
| A1–A15, B1–B4, B6–B11: all Snowflake objects (DDL, DTs, semantic view, procedures, tasks, policies, AI_EXTRACT pipeline, sharing, Cortex Agent objects) | **CoCo** | Live-account context and built-in skills (`$dynamic-tables`, `$semantic-view`, `$cortex-agent`, `$agent-optimize`, `/sql` + Plan Mode); validates against real data and cost |
| B5 domain logic (shelf-life model, option generator, scorer, solver, claim calculator) | **Claude** writes it as pure Python with unit tests → **CoCo** packages it as Snowpark procedures and validates in the account | The logic can be tested offline; deployment belongs in the account |
| D1–D5 agent specs, instructions, reference cards; compiled DDL | **Claude** authors → **CoCo** creates, tests and tunes the agents in Snowflake | Specs are code-reviewed text; CoCo runs the agents and evals |
| C1–C11 application code | **Claude** | Software engineering |
| E1–E7 frontend | **Claude** | Software engineering |
| F mocks, simulator, Docker Compose | **Claude** | Software engineering |
| Interface specs: JSON Schemas, procedure signatures, expected test results | **Claude** drafts; both sides implement to them | One contract across the boundary |
| SQL invariant tests | **CoCo** runs them in the account; **Claude** writes the app-side integration and e2e tests | Both sides test |
| `.cortex/skills` (deploy, verify ledger, replay, case forensics) | **Claude** writes the skill files → **CoCo** executes them | Skills are text; they run in CoCo |

**How the CoCo side is operated:**
- The installed Cortex Code is the desktop app, so CoCo work packages are **run by you in Cortex Code** using task briefs I prepare.
- I verify every result independently with read-only `snow sql` and the test suite.
- If a headless CoCo CLI becomes available, the same briefs can run unattended.

---

# Phase 8 — Snowflake Architecture (no frontend)

## Conventions
- **Money** is `NUMBER(14,2)`, **price per kg** `NUMBER(10,4)` and **kg** `NUMBER(14,3)`. A bare `NUMBER` rounds silently.
- **Timestamps** are `TIMESTAMP_TZ`.
- **RAW, LEDGER and REF content rows are append-only.**
- **REF and GOV are versioned.** Every row carries `version, valid_from, valid_to, is_current, changed_by, change_reason`, and only the governed procedures write to them.
- **Procedures** run `EXECUTE AS OWNER`. Anything with logic, hashing or JSON Schema validation is Python; thin wrappers are SQL.
- **Replay doesn't depend on Time Travel retention.** It filters append-only RAW data by `received_at ≤ as_of`.

## 0. Account-level prerequisites
| Object | Purpose |
|---|---|
| DB `BBC_OS` (`DATA_RETENTION_TIME_IN_DAYS = 30` if the edition allows) | Everything below lives here |
| WH `BBC_TRANSFORM_WH` (XS) | Dynamic Table refresh and tasks, kept separate so cost is attributable |
| WH `BBC_APP_WH` (XS) | Procedures, agents, API |
| Roles: `BBC_OWNER`, `BBC_INGEST`, `BBC_ENGINE`, `BBC_AGENT_RUNTIME`, `BBC_QUALITY_MGR`, `BBC_SALES_MGR`, `BBC_FINANCE_MGR`, `BBC_AUDITOR`, `BBC_GOVERNANCE_ADMIN` | Least privilege (see the grants matrix) |
| Users: `BBC_ENGINE_SVC` (default role `BBC_ENGINE`), `BBC_AGENT_SVC` (default role `BBC_AGENT_RUNTIME`; used only to invoke agents), plus one demo user per persona and an auditor | Cortex Agents take their permissions from the caller's **default** role, so agent calls run with minimal rights |
| `GRANT USE AI FUNCTIONS`; `CORTEX_ENABLED_CROSS_REGION` (already set) | Cortex access |

## 1. Schemas
| Schema | Purpose | Written by | Read by |
|---|---|---|---|
| `RAW` | Append-only landing | Connectors (`BBC_INGEST`) | OPS Dynamic Tables |
| `REF` | Versioned reference data | `API.APPLY_REFERENCE_CHANGE` | Procedures, Dynamic Tables, semantic view |
| `GOV` | Versioned policy | `API.ACTIVATE_POLICY` (drafts authored through CoCo) | Procedures |
| `OPS` | Typed operational facts + thermal state (Dynamic Tables) | Dynamic Tables only | Procedures, semantic view, tools |
| `EVIDENCE` | Documents, extracted claims, consistency checks, evidence packs | Extraction task, procedures | Procedures, tools |
| `CASE` | Recovery Case lifecycle records + outbox | Procedures only | Procedures, semantic view, API |
| `LEDGER` | Hash-chained audit trail | `LEDGER.APPEND` only | Verification, auditor |
| `SEM` | Semantic view | CoCo | Procedures, API, analysts |
| `AGENT` | 4 Cortex Agents + their tool procedures | CoCo | `BBC_AGENT_RUNTIME` |
| `API` | The *only* procedures app roles can call | CoCo | Engine, personas, auditor, admin |

## 2. Tables

### RAW (append-only)
| Object | Purpose | Inputs | Outputs | Grain | Dependencies | Why Snowflake |
|---|---|---|---|---|---|---|
| `RAW.TELEMETRY` | Sensor readings: pulp probe, reefer supply/return air, setpoint, mode, door, alarms, interval | IoT connector | `OPS.TELEMETRY_ASSIGNED` | device × reading_ts (deduplicated by `idempotency_key`) | — | Immutable evidence; replay by `received_at` |
| `RAW.BUSINESS_EVENTS` | One envelope for all non-telemetry records: SAP sales orders, deliveries, stock, QM inspections; TMS custody and status; EDI ASN; sensor assignments; claim responses | SAP, TMS, files / EDI connectors | OPS typed Dynamic Tables | source × entity_type × external_id × received version | — | One governed landing table instead of one per entity; replayable |
| `RAW.CONNECTOR_STATE` | Delta cursors (e.g. SAP `LastChangeDateTime`) | Connectors | Connectors | connector × stream | — | The cursor commits in the **same transaction** as the data, so there are no gaps or duplicates |
| `RAW.INGEST_ERRORS` | Rejected payloads (dead-letter queue) | Connectors | Data-gap evidence for Forensics | rejected record | — | A data gap becomes an auditable fact |

### REF (versioned; written only by `API.APPLY_REFERENCE_CHANGE`)
| Object | Purpose | Grain | Used by |
|---|---|---|---|
| `REF.PARTIES` | Growers, packhouses, carriers, DCs, customers, processors; customer tier; account notes | party × version | Options, party-context tool, sharing |
| `REF.SITES` | Blocks, packhouses, DCs, customer DCs, processors (location) | site × version | Lanes, options |
| `REF.LANES` | Site → site transit hours (p50 / p90), cost per load | lane × mode × version | Re-route feasibility, deadlines, costs |
| `REF.PRODUCTS` | Variety / pack / organic + **shelf-life parameters** (reference life at Tref, Tref, Q10, threshold, tolerance, assumption for unmonitored time, validity range) | product × version | Thermal Dynamic Tables, user-defined functions (UDFs), model-validity tool |
| `REF.CUSTOMER_SPECS` | Minimum shelf life at receipt, maximum arrival pulp temperature, organic requirement | customer × product × version | Feasibility |
| `REF.CONTRACTS` | Structured terms (liability cap, claim window, claim minimum, temperature clause, pre-cool clause, penalties, price) **plus clause text** and source document | contract × version | Scorer, Claims agent |
| `REF.CHANNEL_PRICES` | Price per kg by channel: contract, regional, processor, foodservice, donation value | product × channel × effective date | NRV |
| `REF.SENSORS` | Device type, placement, calibration date, owner | device × version | Evidence-trust judgments |

- **Inputs:** CSV through the files connector, or SAP master data, always passed through the governed procedure.
- **Why Snowflake:** decisions must record the *exact* reference versions used, and every change is written to the ledger.

### GOV (versioned policy; activated only by `API.ACTIVATE_POLICY`)
| Object | Purpose | Grain |
|---|---|---|
| `GOV.POLICY_VERSIONS` | Version registry: status (DRAFT / ACTIVE / RETIRED), activated by, reason, content hash | version |
| `GOV.DECISION_RIGHTS` | Decision point × action type × conditions (value band, tier, confidence, decider kind, food-safety flag) → AUTO / APPROVE(roles) / DENY | rule × version |
| `GOV.ROUTER_RULES` | Escalation triggers (NEAR_TIE, HIGH_EXPOSURE, STRATEGIC_CUSTOMER, MODEL_OUT_OF_RANGE, EVIDENCE_CONFLICT, CAUSE_AMBIGUOUS, QUALITATIVE_SIGNAL) with thresholds → target agent | trigger × version |
| `GOV.HARD_LIMITS` | Food-safety limits that make an option infeasible | limit × product × version |
| `GOV.PARAMETERS` | Autonomy mode (OFF / SHADOW / ASSIST / AUTO), deadline and approval buffers, evidence-coverage requirements, consistency tolerances, detection window | key × version |
| `GOV.MODEL_REGISTRY` | Allowed provider / model per agent and data class; the rule that the auditor must be independent of the author | provider × model × agent × version |

- **Inputs:** drafts written through CoCo; activation through the procedure.
- **Outputs:** routing, policy evaluation, option feasibility.
- **Why Snowflake:** policy is enforced on the server, can't be bypassed by the app, and its version is stamped on every evaluation.

### EVIDENCE
| Object | Purpose | Inputs | Outputs | Grain | Dependencies | Why Snowflake |
|---|---|---|---|---|---|---|
| `EVIDENCE.DOC_STAGE` (internal stage, `SNOWFLAKE_SSE`, `DIRECTORY = TRUE`) | Immutable document files: inspection certificates, BOLs, receiving reports, reefer downloads, incident notes, contracts | Files connector, carrier documents | Directory stream | file | — | Evidence stays inside the governance boundary; presigned export |
| `EVIDENCE.DOCUMENTS` | Document metadata: sha256, type, related lot / shipment / contract, source, `received_at` | Extraction task | Claims, packs | document | `DOC_STAGE` | Content hash makes the document tamper-evident |
| `EVIDENCE.DOCUMENT_CLAIMS` | Extracted claims (field, value, unit, claimed timestamp, page) + free-text narratives | `AI_EXTRACT` | Consistency checks, tools | document × claim | `DOCUMENTS` | Extraction happens in-platform; nothing leaves |
| `EVIDENCE.EVIDENCE_PACKS` | **A sealed snapshot of every fact a decision used**: metric values, exposure by custody, documents and verdicts, specs / contract / price / parameter versions, order lines, candidate inventory, data gaps, deadline inputs. Includes `as_of` and `content_hash` | `CASE.BUILD_ASSESSMENT` | Options, agents, replay, export | case × decision point × revision | OPS, REF, EVIDENCE | The single place evidence lives; replayable |

### CASE (lifecycle; written only by procedures)
| Object | Purpose | Grain | Written by |
|---|---|---|---|
| `CASE.CASES` | The Recovery Case: state, decision point (D1 / D2), severity, onset, custody holder at onset, `deadline_ts`, value at risk, `needs_reassessment`, lease (`lease_owner`, `lease_until`) | case | `OPEN_CASES`, `ADVANCE_CASE`, submissions |
| `CASE.CASE_LOTS` | The lots in a case | case × lot | `OPEN_CASES` |
| `CASE.CAUSATION_FINDINGS` | Forensics output, or the deterministic attribution flagged `UNADJUDICATED` | case × revision | `SUBMIT_CAUSATION_FINDING` / `ADVANCE_CASE` |
| `CASE.OPTIONS` | Option bundles (disposition per lot, destination, order recovery, financial action); feasibility; `expires_at`; scores (NRV parts, penalties, rejection risk, recovery probability); default / fallback flags; variants from `SCORE_VARIANT` | option (case × decision point × revision) | `GENERATE_AND_SCORE_OPTIONS`, `SCORE_VARIANT` |
| `CASE.RECOMMENDATIONS` | Chosen option; decider (kind, id, version, provider / model); rationale; rejected alternatives; citations; confidence; robustness; escalation reasons; auditor verdict | recommendation | `ROUTE` (rule) / `SUBMIT_RECOMMENDATION` / `SUBMIT_CLAIM_RECOMMENDATION` |
| `CASE.POLICY_EVALUATIONS` | Policy version, matched rules, outcome, required roles, value at risk | evaluation | `EVALUATE_POLICY` |
| `CASE.APPROVALS` | Request and decision: required role, user, role used, verdict, chosen option, reason, evidence hash at request and at decision, freshness | approval × required role | `EVALUATE_POLICY`, `DECIDE_APPROVAL` |
| `CASE.ACTIONS` (**the outbox**) | Each action: type (REROUTE, STOCK_BLOCK, SO_CHANGE, PROCESSOR_SO, REPROMISE_NOTICE, CLAIM_NOTICE, FILE_CLAIM, GROWER_DEDUCTION, ABSORB, REQUEST_EVIDENCE); target system; payload; idempotency key; status; external reference; attempts | action | `COMMIT_EXECUTION`, `REQUEST_EVIDENCE`, `ACK_ACTION` |
| `CASE.CLAIMS` | Claim lifecycle (NOTICE_SENT → FILED → RESPONDED → SETTLED / DENIED / ABSORBED), counterparty, basis, amount, deadline, letter, evidence pack | claim | `COMMIT_EXECUTION`, `ACK_ACTION`, D2 |
| `CASE.OUTCOMES` | Observed (receipt QC, actual shelf life, sale value, claim result) vs predicted vs default; realized NRV; prediction error | case × lot | `COMPUTE_OUTCOME` |
| `CASE.AGENT_RUNS` | Each agent call: agent, provider, model, spec and reference-card versions, input hash, tool-call hashes, status, latency, tokens | run | `API.RECORD_AGENT_RUN` |

- **Inputs:** lifecycle procedures only.
- **Outputs:** the semantic view, the API, the ledger.
- **Why Snowflake:** these records *are* the decision evidence and the enforcement state.

### LEDGER
| Object | Purpose | Inputs | Outputs | Grain | Why Snowflake |
|---|---|---|---|---|---|
| `LEDGER.ENTRIES` | Append-only hash chain: `seq, ts, case_id, entry_type, actor, record_ref, payload, payload_hash, prev_hash, entry_hash`. Entry types: CASE_OPENED, ASSESSMENT_SEALED, FINDING, OPTIONS_SCORED, RECOMMENDATION, AUDIT_VERDICT, POLICY_EVALUATION, APPROVAL, ACTION_QUEUED, ACTION_ACKED, TRANSITION, OUTCOME, CLAIM_UPDATE, CASE_SEALED, POLICY_ACTIVATED, REFERENCE_CHANGED, AGENT_RUN | `LEDGER.APPEND` | Verification, export, sharing | entry | The audit trail must live in the governed store. No role has UPDATE or DELETE |
| `LEDGER.HEAD` | `last_seq`, `last_hash`. Its UPDATE inside the append transaction **serializes concurrent appenders** | `APPEND` | `APPEND` | single row | Chain integrity under concurrency |

The ledger keeps its **own copy of each payload**. Verification is therefore self-contained, and a reconciliation check shows that the mutable working tables (case state, action status) still match their last ledger payload.

## 3. Relationships (logical foreign keys)
- **Product and grower:** `OPS.LOTS.product_id → REF.PRODUCTS`, `LOTS.grower_id → REF.PARTIES`, `LOTS.harvest_site_id → REF.SITES`.
- **Shipments:**
  - `OPS.SHIPMENT_LOTS (shipment_id → SHIPMENTS, lot_id → LOTS)`;
  - `SHIPMENTS.carrier_id → REF.PARTIES`;
  - `SHIPMENTS.reefer_device_id → REF.SENSORS`.
- **Custody and devices:** `OPS.CUSTODY_EVENTS.(lot_id | shipment_id)`, with `from_party / to_party → REF.PARTIES`. `OPS.DEVICE_ASSIGNMENTS.device_id → REF.SENSORS`, target → LOTS / SHIPMENTS.
- **Orders, inventory, QC:**
  - `OPS.ORDER_LINES.customer_id → REF.PARTIES`, `assigned_lot_id → LOTS`, `(customer, product) → REF.CUSTOMER_SPECS`;
  - `OPS.INVENTORY_SNAPSHOTS.(lot_id, site_id)`;
  - `OPS.QC_INSPECTIONS.lot_id`.
- **Contracts and lanes:** `REF.CONTRACTS.party_id → REF.PARTIES`; `REF.LANES.(origin, dest) → REF.SITES`.
- **Documents:** `EVIDENCE.DOCUMENT_CLAIMS.doc_id → DOCUMENTS`; `DOCUMENTS.(lot | shipment | contract)`.
- **Case links:**
  - `CASE.CASE_LOTS (case_id → CASES, lot_id → LOTS)`;
  - OPTIONS, FINDINGS, RECOMMENDATIONS, POLICY_EVALUATIONS, APPROVALS, ACTIONS, CLAIMS, OUTCOMES, AGENT_RUNS, EVIDENCE_PACKS all → `case_id`, denormalized for simple joins.
- **Decision chain:** `RECOMMENDATIONS.option_id → OPTIONS`; `POLICY_EVALUATIONS.rec_id → RECOMMENDATIONS`; `APPROVALS.eval_id → POLICY_EVALUATIONS`; `ACTIONS.rec_id → RECOMMENDATIONS`.
- **Ledger:** `LEDGER.ENTRIES.record_ref → (table, id)`.

## 4. Event / state model

**Operational events:**
- telemetry readings and business events (custody, orders, stock, QC, responses) arrive in RAW;
- documents arrive on the stage;
- derived events: bucket changes (stream) → case opening; new documents (stream) → `needs_reassessment`;
- the deadline is crossed (watchdog task);
- approvals (user calls);
- acks (dispatcher calls);
- outcome facts (QC arrives).

Every one of them ends up as a ledger entry.

**Case states.** Every transition is checked by `API.ADVANCE_CASE` or a `SUBMIT_*` procedure against an expected state.

| From | To | Performed by | Ledger entry |
|---|---|---|---|
| — | OPEN | `CASE.OPEN_CASES` (task) | CASE_OPENED |
| OPEN | ASSESSED | `BUILD_ASSESSMENT` | ASSESSMENT_SEALED |
| ASSESSED | FORENSICS_PENDING / FINDING_RECORDED | `ROUTE` (trigger fired / deterministic attribution) | TRANSITION / FINDING |
| FORENSICS_PENDING | FINDING_RECORDED | `AGENT.SUBMIT_CAUSATION_FINDING` | FINDING |
| FINDING_RECORDED | OPTIONS_SCORED | `GENERATE_AND_SCORE_OPTIONS` | OPTIONS_SCORED |
| OPTIONS_SCORED | RECOMMENDED (rule) / STRATEGY_PENDING (D1) / CLAIMS_PENDING (D2) | `ROUTE` | RECOMMENDATION / TRANSITION |
| STRATEGY_PENDING / CLAIMS_PENDING | RECOMMENDED | `SUBMIT_RECOMMENDATION` / `SUBMIT_CLAIM_RECOMMENDATION` | RECOMMENDATION |
| RECOMMENDED | AUDITED (AI-written text goes through AUDIT_PENDING) | `SUBMIT_AUDIT_VERDICT` | AUDIT_VERDICT |
| AUDITED | AUTO / PENDING_APPROVAL / DENIED / SHADOW_RECORDED | `EVALUATE_POLICY` | POLICY_EVALUATION |
| PENDING_APPROVAL | APPROVED / ALTERNATIVE_CHOSEN (→ re-evaluate) / REJECTED (→ fallback) | `API.DECIDE_APPROVAL` | APPROVAL |
| PENDING_APPROVAL / any pre-execution state past the deadline | FALLBACK_EXECUTED | `ENFORCE_DEADLINES` (task) | TRANSITION |
| AUTO / APPROVED | EXECUTING → EXECUTED / EXECUTION_FAILED | `COMMIT_EXECUTION`, then `API.ACK_ACTION` | ACTION_QUEUED / ACTION_ACKED |
| EXECUTED (D1) | AWAITING_OUTCOME → OUTCOME_RECORDED | `COMPUTE_OUTCOME` (when receipt QC arrives, or on timeout) | OUTCOME |
| OUTCOME_RECORDED | D2: ASSESSED → … → EXECUTING → CLAIM_OPEN | Same procedures with `decision_point = D2` | as above |
| CLAIM_OPEN | CLAIMS_PENDING (new counterparty response) / SETTLED | Engine work selection / `ACK_ACTION` | CLAIM_UPDATE |
| SETTLED or ABSORBED | SEALED | `SEAL_CASE` | CASE_SEALED |

## 5. Dynamic Tables
| Object | Purpose | Inputs | Outputs | Grain | Refresh | Why Snowflake |
|---|---|---|---|---|---|---|
| `OPS.LOTS` | Typed lots (product, grower, harvest site and time, kg, organic) | `RAW.BUSINESS_EVENTS` | Everything | lot (latest version) | INCREMENTAL if eligible, otherwise FULL (low volume) | Declarative typing of governed data |
| `OPS.SHIPMENTS` | Carrier, origin / destination, planned times, reefer device, BOL setpoint | same | Exposure, options, claims | shipment | same | same |
| `OPS.SHIPMENT_LOTS` | Lot on shipment, kg (flattened from shipment payload) | same | same | shipment × lot | same | same |
| `OPS.CUSTODY_EVENTS` | Handoff / load / unload / arrive / depart, with party and site | same | Custody ASOF | event | INCREMENTAL (append-only) | same |
| `OPS.DEVICE_ASSIGNMENTS` | Device ↔ lot / shipment intervals | same | Telemetry ASOF | device × interval | INCREMENTAL | same |
| `OPS.ORDER_LINES` | Customer order lines with assigned lot, ship-to, requested date, price, status | same | Options, exposure | order line (latest) | INCREMENTAL / FULL | same |
| `OPS.INVENTORY_SNAPSHOTS` | Stock by lot × site × status (**semi-additive**) | same | Replacement-lot options | lot × site × snapshot | INCREMENTAL | same |
| `OPS.QC_INSPECTIONS` | Inspection results (receipt QC = outcome evidence) | same | Outcomes, Forensics | inspection | INCREMENTAL | same |
| `OPS.COUNTERPARTY_RESPONSES` | Carrier / grower replies to claims | same | D2 | response | INCREMENTAL | same |
| `OPS.TELEMETRY_ASSIGNED` | Each reading → its lot (**ASOF JOIN** to device assignment) → its custody holder (**ASOF JOIN** to custody events). Adds the consumption rate and excess life per reading (UDF). Keeps `received_at` | `RAW.TELEMETRY`, `DEVICE_ASSIGNMENTS`, `CUSTODY_EVENTS`, `REF.PRODUCTS` | Buckets, evidence packs, telemetry tool | reading × lot | INCREMENTAL target; **CoCo must verify ASOF eligibility** (fallback: interval range join) | Continuous physics next to the data; one definition |
| `OPS.LOT_THERMAL_BUCKETS` | Lot × custody holder × 15 min: reading minutes, breach minutes, degree-minutes above, consumed life, **excess life**, maximum pulp / air temperature, door events | `TELEMETRY_ASSIGNED` | Detection stream, semantic view, custody attribution | lot × holder × 15-min bucket | INCREMENTAL (SUM / MAX / COUNT) | Cheap continuous detection over high-volume telemetry |
| `EVIDENCE.DOCUMENT_CONSISTENCY` | Each temperature or time claim vs sensor truth at the claimed time (ASOF) → CONSISTENT / CONFLICT / UNVERIFIABLE, using the tolerance from `GOV.PARAMETERS` | `DOCUMENT_CLAIMS`, `TELEMETRY_ASSIGNED`, `GOV.PARAMETERS` | Forensics, packs | document claim | FULL acceptable (low volume) | Joins documents to sensors where both live |

**Physics, defined once:**
- `rate(T) = Q10^((T − Tref)/10)`.
- **Consumed life** = Σ rate(T) × Δt.
- **Excess life** (used for attribution) = Σ max(rate(T) − rate(T_threshold), 0) × Δt.
- **Never inside a Dynamic Table:** "now" (`CURRENT_TIMESTAMP`). Projection to the current time or the ETA happens in UDFs and procedures.

## 6. Streams and tasks (only three uses)
| Object | Purpose | Inputs | Outputs | Why Snowflake |
|---|---|---|---|---|
| `CASE.S_THERMAL_BUCKETS` (stream on the Dynamic Table) + `CASE.T_DETECT` (triggered task) → `CASE.OPEN_CASES()` | Open or extend cases when breaches accumulate (window and tolerance come from `GOV.PARAMETERS`) | Bucket changes | CASES, CASE_LOTS, ledger | Event processing next to the data; works with the app down |
| `EVIDENCE.S_DOC_STAGE` (stream on the directory table) + `EVIDENCE.T_EXTRACT` (triggered task) → `EVIDENCE.EXTRACT_NEW_DOCUMENTS()` | Run `AI_EXTRACT` on new files; flag affected open cases `needs_reassessment` | New files | DOCUMENTS, DOCUMENT_CLAIMS | Documents never leave Snowflake |
| `CASE.T_DEADLINE_WATCHDOG` (every minute) → `CASE.ENFORCE_DEADLINES()` | Run the **safe fallback** on cases past their deadline that have no executed decision | CASES | ACTIONS, ledger | The fail-safe works even if the app or approvers are down |

**Fallback** if a triggered task on a Dynamic Table stream isn't available: a scheduled task every minute.

## 7. Semantic view `SEM.EXCURSION_RECOVERY` and metrics

**Purpose:** each metric defined once. It's used by procedures (through `SEMANTIC_VIEW()` queries when building evidence packs and KPIs), by the API and by analysts.

**Logical tables:** lots, products (`is_current`), thermal buckets, order_lines, inventory (`NON ADDITIVE BY snapshot`), case_lots, cases, options, recommendations, approvals, actions, claims, outcomes.

**Why Snowflake:** it's the "same question, same answer" guarantee, and procedures read their metrics from it.

| Group | Metric | Definition (grain) |
|---|---|---|
| **Business** | `REMAINING_SHELF_LIFE_DAYS` | (reference life − monitored consumed life − unmonitored minutes × rate(assumed temperature)) ÷ 1440; per lot, as of the last reading |
| | `TEMPERATURE_COMPLIANCE_PCT` | 1 − breach minutes ÷ reading minutes (lot / shipment) |
| | `THERMAL_EXPOSURE_DEG_H` | Σ degree-minutes above threshold ÷ 60 (lot × custody holder) |
| | `CUSTODY_EXPOSURE_SHARE` | holder's excess life ÷ the lot's total excess life (lot × holder) |
| | `QUALITY_ADJUSTED_ATP_KG` | on hand − held − allocated (lot × site, non-additive over snapshot) |
| **Decision** | `TIME_TO_DETECT_MIN` | case opened − first breach bucket |
| | `TIME_TO_DECISION_MIN` | final approval or AUTO − case opened |
| | `DEADLINE_MET_RATE` | share of decisions executed before `deadline_ts` |
| | `RULE_DECIDED_SHARE` / `AGENT_DECIDED_SHARE` | recommendations by decider kind |
| | `HUMAN_OVERRIDE_RATE` | approvals that were ALTERNATIVE_CHOSEN or REJECTED ÷ approvals |
| | `APPROVAL_LATENCY_MIN` | decided_at − requested_at |
| | `AUDITOR_FAIL_RATE` | FAIL verdicts ÷ audited artifacts |
| | `FALLBACK_RATE` | FALLBACK_EXECUTED ÷ cases |
| **Risk** | `VALUE_AT_RISK_USD` | plan value of case lots whose predicted shelf life at ETA is below spec |
| | `REJECTION_RISK` | the option's predicted probability of rejection at receipt |
| | `SHELF_LIFE_PREDICTION_ERROR_DAYS` | mean absolute error of predicted vs actual shelf life at receipt (outcomes) |
| | `EVIDENCE_COVERAGE_PCT` | required evidence types present ÷ required |
| | `EVIDENCE_CONFLICT_RATE` | CONFLICT verdicts ÷ checked claims |
| **Financial** | `PLANNED_VALUE_USD` | kg × contract price |
| | `REALIZED_VALUE_USD` | actual sale value after disposition |
| | `INCREMENTAL_COST_USD` / `PENALTIES_USD` | executed costs / penalties incurred |
| | `CLAIMS_FILED_USD` / `CLAIMS_RECOVERED_USD` / `CLAIM_RECOVERY_RATE` | from CLAIMS |
| | `NET_RECOVERED_VALUE_USD` | realized + recovered − incremental cost − penalties |
| | `DEFAULT_COUNTERFACTUAL_USD` | NRV of the default option (always scored) |
| | `VALUE_PROTECTED_USD` | NRV − the default counterfactual |

## 8. Functions
| Object | Purpose | Inputs → Output | Used by | Why Snowflake |
|---|---|---|---|---|
| `OPS.SHELF_LIFE_RATE` (SQL UDF) | Relative rate at which shelf life is consumed | temp, Tref, Q10 → rate | `TELEMETRY_ASSIGNED`, projections | One physics definition, usable inside Dynamic Tables |
| `OPS.PROJECT_SHELF_LIFE_DAYS` (SQL UDF) | Remaining shelf life at a future time under an assumed temperature | remaining hours, hours ahead, temp, Tref, Q10 → days | Option generator, deadline computation | Same formula everywhere |
| `LEDGER.CANONICAL_HASH` (Python UDF) | sha256 of canonical JSON (sorted keys, fixed separators) | VARIANT → hex | `APPEND`, `VERIFY_LEDGER`, packs | Identical canonicalization when writing and verifying |

## 9. Stored procedures

### Internal (owner only; called by tasks or other procedures)
| Procedure | Purpose | Inputs → Outputs | Grain | Dependencies |
|---|---|---|---|---|
| `CASE.OPEN_CASES()` (SQL) | Detect breaches over the trailing window; open or extend one case per shipment episode | stream rows → CASES, CASE_LOTS | per run | Buckets, `GOV.PARAMETERS` |
| `CASE.BUILD_ASSESSMENT(case_id, dp, as_of)` (Py) | Build and seal the evidence pack: shelf life, exposure by custody (reading level, `received_at ≤ as_of`), affected orders, value at risk, gaps, consistency verdicts, deadline inputs | → `EVIDENCE_PACKS`, CASES fields | case × dp | OPS, REF, EVIDENCE, semantic view |
| `CASE.GENERATE_AND_SCORE_OPTIONS(case_id, dp)` (Py; Claude's domain modules) | Option generator + NRV scorer + replacement-lot solver (scipy) + claim calculator; always adds the default and fallback options; expiry times | pack → OPTIONS | case × dp | REF, `GOV.HARD_LIMITS` |
| `CASE.ROUTE(case_id, dp)` (Py) | Dominance test + router triggers → a rule recommendation, or an escalation with reason codes | OPTIONS → RECOMMENDATIONS / state | case × dp | `GOV.ROUTER_RULES` |
| `CASE.EVALUATE_POLICY(rec_id)` (Py) | Match decision rights + autonomy mode → AUTO / APPROVE / DENY / SHADOW; create approval requests | → POLICY_EVALUATIONS, APPROVALS | recommendation | GOV |
| `CASE.COMMIT_EXECUTION(rec_id)` (SQL) | **One transaction**: case state, inventory hold or order intent, outbox ACTIONS, CLAIMS row, ledger | → ACTIONS, CLAIMS | recommendation | — |
| `CASE.ENFORCE_DEADLINES()` (SQL) | Execute the safe fallback on overdue cases | → ACTIONS | per run | CASES, OPTIONS |
| `CASE.COMPUTE_OUTCOME(case_id)` (Py) | Observed vs predicted vs default; realized NRV | QC, ACTIONS, CLAIMS → OUTCOMES | case × lot | OPS |
| `CASE.SEAL_CASE(case_id)` (SQL) | Final ledger entry; lock the case | → ledger | case | — |
| `EVIDENCE.EXTRACT_NEW_DOCUMENTS()` (SQL + `AI_EXTRACT`) | Extract claims and narratives; flag cases for reassessment | stream → DOCUMENTS, DOCUMENT_CLAIMS | per run | `DOC_STAGE` |
| `LEDGER.APPEND(entry_type, case_id, actor, record_ref, payload)` (SQL) | Lock HEAD → hash → insert ENTRIES → update HEAD | → ENTRIES | entry | `CANONICAL_HASH` |

### API (the only procedures app roles can call)
| Procedure | Caller role | Purpose |
|---|---|---|
| `API.CLAIM_WORK(worker_id, lease_s)` | Engine | Lease the next case that needs a step (expired leases can be reclaimed); return the next step, including **which agent to invoke** |
| `API.ADVANCE_CASE(case_id, expected_state)` | Engine | Run the next deterministic stage(s) idempotently; enforce allowed transitions |
| `API.RECORD_AGENT_RUN(run)` | Engine | Log the agent-run audit data (provider, model, versions, tool hashes, latency, tokens) |
| `API.NEXT_ACTIONS(dispatcher_id, limit)` | Engine | Lease queued outbox actions |
| `API.ACK_ACTION(action_id, status, external_ref, response)` | Engine | Record the external acknowledgement; advance state; update claims |
| `API.DECIDE_APPROVAL(approval_id, verdict, chosen_option_id, reason)` | Personas | Enforce `CURRENT_USER()`, the role (`IS_ROLE_IN_SESSION`), proposer ≠ approver, an evidence-hash freshness re-check and the deadline |
| `API.GET_CASE_VIEW(case_id)` + view `API.V_CASE_INBOX` | Personas, auditor | The read model (frontend designed later) |
| `API.VERIFY_LEDGER(from_seq, to_seq, ledger_table)` (Py) | Auditor | Recompute the chain; works against a **zero-copy clone** for the tamper demo |
| `API.REPLAY_EVIDENCE(pack_id)` (Py) | Auditor | Rebuild the pack as of its `as_of` from append-only RAW + REF versions; compare hashes |
| `API.EXPORT_EVIDENCE_PACK(case_id)` (Py) | Auditor, Finance | Write JSON (+ PDF) of pack + ledger slice to the stage; return a presigned URL |
| `API.ACTIVATE_POLICY(version, reason)` | Governance admin | Activate a policy draft, with a ledger entry |
| `API.APPLY_REFERENCE_CHANGE(entity, records, reason)` | Governance admin, engine (SAP master sync) | Write a new reference version, with a ledger entry |

**Why Snowflake for all of these:** they are governed enforcement points that run next to the data. Owner's rights mean callers never need table privileges.

## 10. Agent-accessible tools + agents (schema `AGENT`)
| Tool (procedure) | Purpose | Used by |
|---|---|---|
| `GET_CASE_CONTEXT(case_id)` | Assessment summary, custody timeline, finding, escalation reasons, deadline | All except the Auditor |
| `GET_TELEMETRY_WINDOW(case_id, lot_id, from, to, bucket_min)` | Readings / buckets with holder, setpoint, door, alarms | Forensics |
| `GET_DOCUMENT_EVIDENCE(case_id)` | Document claims, narratives, consistency verdicts, sensor metadata | Forensics, Claims |
| `GET_SCORED_OPTIONS(case_id, dp)` | Options, scores, feasibility, expiry | Strategist |
| `SCORE_VARIANT(case_id, option_id, adjustments)` | Deterministic what-if (prediction error, ETA, split) → a stored re-scored variant | Strategist |
| `GET_PARTY_CONTEXT(case_id, party_id)` | Tier, specs, contract terms + clause text, penalties, account notes, counterparty claim history | Strategist, Claims |
| `GET_PRECEDENTS(case_id, k)` | Structurally similar sealed cases, with their decisions and outcomes (from `CASE.V_DECISION_MEMORY`) | Forensics, Strategist, Claims |
| `GET_CLAIM_CONTEXT(case_id)` | Loss computation, claim variants, prerequisites, deadlines, counterparty responses | Claims |
| `GET_ARTIFACT_FOR_AUDIT(artifact_id)` | Artifact text + resolved cited evidence | Auditor |
| `REQUEST_EVIDENCE(case_id, request)` | Create a governed REQUEST_EVIDENCE action | Forensics |
| `SUBMIT_CAUSATION_FINDING` / `SUBMIT_RECOMMENDATION` / `SUBMIT_CLAIM_RECOMMENDATION` / `SUBMIT_AUDIT_VERDICT` | Validate against JSON Schema, check citations exist in the pack, option in scored set and unexpired, numbers match, confidence rules; then advance state + ledger | the respective agent |

**Agents:** `AGENT.EXCURSION_FORENSICS`, `AGENT.RECOVERY_STRATEGIST`, `AGENT.CLAIMS_RECOVERY`, `AGENT.EVIDENCE_AUDITOR`.
- Claude models via Cortex; each agent is bound only to its own tools.
- They're invoked by `BBC_AGENT_SVC`.
- **Why Snowflake:** agent data access is mediated by tools under RBAC; the agents can't write anything except validated submissions.
- **Simplification vs Phase 6:** `get_custody_timeline`, `get_consistency_checks` and `get_sensor_metadata` were merged into `GET_CASE_CONTEXT` and `GET_DOCUMENT_EVIDENCE`.

## 11–14. Governance, approvals, decision memory, audit, evidence (how the objects work together)
- **Governance:** GOV tables (versioned) → `ROUTE` and `EVALUATE_POLICY`. Hard limits are applied while *generating* options, so an infeasible option can never be recommended.
- **Approvals:** `POLICY_EVALUATIONS` + `APPROVALS` → `API.DECIDE_APPROVAL`. Identity comes from Snowflake, not the app. Freshness is checked by comparing the evidence hash at request time with a rebuilt hash at decision time.
- **Decision memory:** `CASE.V_DECISION_MEMORY` (view) has one row per sealed case × lot: features (product, holder type, exposure band, shelf-life band, customer tier, decision point, decider kind, chosen action) plus outcome (NRV vs default, prediction error). Agents query it **only** through `GET_PRECEDENTS`; it's structured, not RAG.
- **Audit trail:** `LEDGER.ENTRIES` + `CASE.AGENT_RUNS` + `VERIFY_LEDGER` + `REPLAY_EVIDENCE`. Tamper demo: clone the ledger, alter one row in the clone, and VERIFY reports the exact `seq`.
- **Evidence storage:** `DOC_STAGE` → `DOCUMENTS` → `DOCUMENT_CLAIMS` → `DOCUMENT_CONSISTENCY` → sealed `EVIDENCE_PACKS` (hash in the ledger) → `EXPORT_EVIDENCE_PACK`.
- **Stretch:** `EVIDENCE.V_COUNTERPARTY_EVIDENCE` (secure view) + row access policy by party + share or reader account. **Verify on trial.**

## 15. Grants matrix
| Role | Privileges |
|---|---|
| `BBC_INGEST` | INSERT on RAW tables; WRITE on `DOC_STAGE`. Nothing else |
| `BBC_ENGINE` | USAGE on engine procedures in `API`; USAGE on `BBC_APP_WH` |
| `BBC_AGENT_RUNTIME` | USAGE on the 4 agents + 14 `AGENT` tools; USAGE on `BBC_APP_WH`. **No table privileges** |
| `BBC_QUALITY_MGR` / `SALES_MGR` / `FINANCE_MGR` | USAGE on `DECIDE_APPROVAL`, `GET_CASE_VIEW`; SELECT on `V_CASE_INBOX` |
| `BBC_AUDITOR` | USAGE on `VERIFY_LEDGER`, `REPLAY_EVIDENCE`, `EXPORT_EVIDENCE_PACK`, `GET_CASE_VIEW`; SELECT on LEDGER / CASE / EVIDENCE |
| `BBC_GOVERNANCE_ADMIN` | USAGE on `ACTIVATE_POLICY`, `APPLY_REFERENCE_CHANGE`; INSERT DRAFT rows into GOV |
| `BBC_OWNER` | Owns everything. Not used by any person or app at runtime |

## 16. Object inventory
- **Schemas:** 10.
- **Tables:** 34 (RAW 4, REF 8, GOV 6, EVIDENCE 3, CASE 11, LEDGER 2).
- **Dynamic Tables:** 12.
- **Views:** 2.
- **Stage:** 1.
- **Streams:** 2.
- **Tasks:** 3.
- **UDFs:** 3.
- **Procedures:** 37 (11 internal, 12 API, 14 agent tools).
- **Cortex Agents:** 4.
- **Semantic view:** 1.
- **Stretch:** 1 secure view, 1 row access policy, 1 share.

## 17. CoCo build order (work packages, in dependency order)
| WP | Contents | CoCo capability |
|---|---|---|
| 1 | Database, schemas, warehouses, roles, users, grants skeleton. **Feature checks:** 30-day retention, triggered task on Dynamic Table stream, ASOF in incremental Dynamic Table, directory stream, `AI_EXTRACT` on PDF, Python packages (jsonschema, scipy), Claude models in Cortex, agent REST with PAT, reader account on trial | `/sql` + Plan Mode |
| 2 | RAW, REF, GOV, LEDGER tables; `CANONICAL_HASH`; `LEDGER.APPEND`; `APPLY_REFERENCE_CHANGE`; `ACTIVATE_POLICY` | `/sql` |
| 3 | OPS typed Dynamic Tables; physics UDFs; `TELEMETRY_ASSIGNED`; `LOT_THERMAL_BUCKETS`; confirm refresh modes | `$dynamic-tables` |
| 4 | EVIDENCE stage, tables, extraction procedure + stream / task, `DOCUMENT_CONSISTENCY` | `/sql`, `$dynamic-tables` |
| 5 | Semantic view + metric checks | `$semantic-view` |
| 6 | CASE tables; internal procedures (Python modules from Claude); detection + watchdog tasks | `/sql` + Plan Mode |
| 7 | API procedures + view + grants | `/sql` |
| 8 | AGENT tools + 4 Cortex Agents (specs compiled by Claude) + evals | `$cortex-agent`, `$agent-optimize` |
| 9 | SQL invariant test suite (+ stretch sharing) | `/sql` |

---

# Phase 9 — Decision Semantic Model (`SEM.EXCURSION_RECOVERY`)

## Design stance
- **The center of the model is the decision**, not the shipment or the KPI.
- The core entity is the **DECISION**: one row per case × decision point. It links the evidence the decision saw, the option it chose, the default it was measured against, the governance path it took, and the outcome it produced.
- Physical entities (lots, thermal state, inventory, orders) exist to explain decisions.
- Two time regimes are kept strictly apart:

| Regime | What it answers | Data used |
|---|---|---|
| **Live metrics** | "What is true now?" | Current state + current parameters |
| **Decision metrics** | "What did we know and decide then, and what happened?" | Values **frozen at decision time** (evidence pack, OPTIONS, CASE_LOTS). They are never recomputed with today's parameters or state |

## Entities (logical tables)
| Entity | Base object | Grain (primary key) | Role in the decision | Time semantics |
|---|---|---|---|---|
| LOT | `OPS.LOTS` | lot_id | The product at risk | Latest version |
| PRODUCT | `REF.PRODUCTS` (`is_current`) | product_id | Shelf-life physics parameters | Current only. Historical decisions use the frozen copy |
| GROWER / CARRIER / CUSTOMER / HOLDER | `REF.PARTIES` (role-playing aliases) | party_id | Counterparties, custody holders | Current |
| LOT_THERMAL_STATE | **new DT** `OPS.LOT_THERMAL_STATE` | lot_id | Lot-level physics totals | As of `last_reading_ts` |
| LOT_CUSTODY_EXPOSURE | **new DT** `OPS.LOT_CUSTODY_EXPOSURE` | lot_id × holder_party_id | Where the excess damage happened | As of `last_reading_ts` |
| THERMAL_BUCKET | `OPS.LOT_THERMAL_BUCKETS` | lot × holder × bucket_start | Time series only (charts, detection) | 15-minute buckets |
| SHIPMENT | `OPS.SHIPMENTS` | shipment_id | Where the lot is; its lane | Current state + `state_as_of` |
| SHIPMENT_LOT | `OPS.SHIPMENT_LOTS` | shipment × lot | kg on the shipment (a bridge) | — |
| ORDER_LINE | `OPS.ORDER_LINES` | order_line_id | The demand the lot was promised to | Latest version |
| INVENTORY | `OPS.INVENTORY_SNAPSHOTS` | lot × site × snapshot_ts | Replacement supply | **Snapshot (semi-additive)** |
| QC_INSPECTION | `OPS.QC_INSPECTIONS` | inspection_id | Quality truth (receipt QC = outcome) | Point in time |
| CASE | `CASE.CASES` | case_id | The excursion episode | Lifecycle |
| CASE_LOT | `CASE.CASE_LOTS` (+ frozen assessment values) | case × lot | **Grain of value at risk** | Frozen at assessment |
| DECISION | **new view** `CASE.V_DECISIONS` | case × decision point | **The decision itself**: final recommendation, chosen and default option values, decider, policy outcome, approval path, timing | Frozen at decision |
| APPROVAL | `CASE.APPROVALS` | approval_id | Human accountability | Event |
| ACTION | `CASE.ACTIONS` | action_id | What was executed; actual costs | Event + status |
| CLAIM | `CASE.CLAIMS` | claim_id | Financial recovery | **Financial state machine** |
| OUTCOME | `CASE.OUTCOMES` | case × lot | What really happened | Observed |

**Not exposed as a logical table:** `CASE.OPTIONS`. Options are *mutually exclusive alternatives*, so aggregating them is meaningless. Their values reach the model only as the **chosen** and **default** option values on DECISION. Agents read the full option set row by row through `GET_SCORED_OPTIONS`.

## Relationships (many-to-one only)
- THERMAL_BUCKET → LOT, HOLDER
- LOT_CUSTODY_EXPOSURE → LOT_THERMAL_STATE → LOT
- LOT → PRODUCT, GROWER
- SHIPMENT_LOT → SHIPMENT, LOT; SHIPMENT → CARRIER
- ORDER_LINE → CUSTOMER, PRODUCT, LOT (assigned)
- INVENTORY → LOT
- QC_INSPECTION → LOT
- CASE → SHIPMENT; CASE_LOT → CASE, LOT; DECISION → CASE
- APPROVAL → DECISION; ACTION → DECISION
- CLAIM → CASE, counterparty PARTY
- OUTCOME → CASE_LOT

**Fan-out rule:** a metric can only be grouped by dimensions reachable from its own entity along many-to-one paths. Example: a LOT metric can't be grouped by a THERMAL_BUCKET dimension, because that would repeat the lot value once per bucket. *CoCo must verify that the semantic view enforces this; the tool allow-lists below enforce it regardless.*

## Dimensions (main ones)
| Entity | Dimensions |
|---|---|
| LOT / PRODUCT | lot_id, harvest_date, variety, pack, organic_flag, grower |
| HOLDER | holder_type (GROWER / PACKHOUSE / CARRIER / DC), holder_name |
| SHIPMENT | shipment_state, lane (origin → destination), carrier, departure_date |
| INVENTORY | **snapshot_ts (non-additive)**, site, stock_status (AVAILABLE / HELD / ALLOCATED / IN_TRANSIT) |
| QC_INSPECTION | inspection_type (ORIGIN / INTERMEDIATE / **RECEIPT**), inspection_date, site |
| CASE | case_state, severity, opened_date, holder_type_at_onset |
| DECISION | decision_point (D1 / D2), **decider_kind** (RULE / AGENT / HUMAN / FALLBACK), chosen_action_kind, policy_outcome, primary_escalation_reason, autonomy_mode, policy_version, attributed_cause, decided_date |
| APPROVAL | required_role, verdict |
| ACTION | action_type, target_system, status |
| CLAIM | claim_status, counterparty_type, basis |
| OUTCOME | outcome_status (OBSERVED / UNKNOWN), accepted_at_receipt |

**All timestamps are UTC (`TIMESTAMP_TZ`).** Date dimensions are UTC dates.

## Metrics
★ marks a **canonical** metric: defined once, versioned in `GOV.METRIC_REGISTRY` (definition hash, owner, unit, grain, allowed dimensions, staleness limit), recorded in evidence packs, and the only kind agents receive. (D) marks a derived metric.

### Canonical metrics
| Name | Definition | Formula | Grain | Source | Business meaning | Agent usage | Governance constraints |
|---|---|---|---|---|---|---|---|
| ★ `REMAINING_SHELF_LIFE_DAYS` | Saleable life left as of the last reading | (ref_life_h − monitored_consumed_h − unmonitored_h × rate(T_assumed)) ÷ 24 | lot | LOT_THERMAL_STATE + PRODUCT | Is the fruit still sellable, and for how long | Forensics, Strategist (via `GET_CASE_CONTEXT`, frozen value) | **Not additive across lots.** Always returned with `as_of` + coverage. Records the parameter version. STALE if data age > limit |
| ★ `PREDICTED_SL_AT_ETA_DAYS` | Shelf life the destination will receive | `PROJECT_SHELF_LIFE_DAYS(remaining_h, p90 transit h, T_expected)` | case_lot × destination | Frozen in CASE_LOTS / options | What the customer gets | Strategist | **Uses p90 transit time** (conservative). Frozen; never recomputed for history |
| ★ `SPEC_MARGIN_DAYS` | Margin against the customer's minimum | PREDICTED_SL_AT_ETA − min_sl_at_receipt | case_lot × destination | Frozen | Feasibility | Strategist | A negative value makes the option **infeasible** (enforced in the generator) |
| ★ `EXCESS_LIFE_SHARE` | Share of *avoidable* shelf-life loss that occurred in each holder's custody | holder_excess_h ÷ lot_total_excess_h | lot × holder | LOT_CUSTODY_EXPOSURE | Where the damage happened | Forensics, Claims | Shares sum to 1 per lot (tested). NULL if total excess = 0. **Attribution is not liability:** liability also needs the causation finding and a contract basis |
| ★ `PLANNED_VALUE_USD` | Value of the lot under the original plan | kg × contract price | case_lot | Frozen at assessment | The baseline | All, via pack | Contract version recorded. USD only |
| ★ `DEFAULT_COUNTERFACTUAL_USD` | Expected NRV if we do nothing | NRV formula applied to the default option | decision | Frozen (scorer) | What inaction is worth | Strategist | Always scored. Frozen |
| ★ `VALUE_AT_RISK_USD` (D) | Value expected to be lost by doing nothing | PLANNED_VALUE − DEFAULT_COUNTERFACTUAL | case_lot → case | Frozen | Urgency and priority | All | **One open case per lot** (an invariant), so summing across cases doesn't double count |
| ★ `PREDICTED_NRV_USD` | Expected NRV of the chosen option | E[sale value] + E[recovery] − incremental cost − E[penalties] | decision | Frozen (scorer) | What the decision is expected to save | Strategist (reads, never computes) | Comes **only** from the scorer. Formula parity with REALIZED_NRV is tested |
| ★ `REALIZED_NRV_USD` | Actual net recovered value | realized_sale + recovered − actual_incremental_cost − actual_penalties | case | OUTCOME, CLAIM, ACTION | What was really saved | Not given to agents for live decisions; precedents only | **Final only when the case is SEALED.** Otherwise reported as `_PROVISIONAL` |
| ★ `VALUE_PROTECTED_USD` (D) | Value created by deciding instead of defaulting | REALIZED_NRV − DEFAULT_COUNTERFACTUAL | case | Derived | The product's headline outcome | Precedents | **SEALED cases only** |
| ★ `QUALITY_ADJUSTED_ATP_KG` | Stock genuinely available to replace | on_hand − held − allocated, status AVAILABLE | lot × site | INVENTORY | Replacement supply | Strategist (via options) | **`NON ADDITIVE BY snapshot_ts`.** Snapshot age must be ≤ limit, or the options using it are flagged |

### Operational metrics
| Name | Definition | Formula | Grain | Source | Business meaning | Agent usage | Governance constraints |
|---|---|---|---|---|---|---|---|
| `TEMPERATURE_COMPLIANCE_PCT` | Monitored time at or below the threshold | 1 − Σ breach_min ÷ Σ reading_min | lot | LOT_THERMAL_STATE | Cold-chain discipline | Forensics | Weighted by minutes, not by reading count. Data gaps are excluded from the denominator, **so it is always paired with coverage** |
| `MONITORING_COVERAGE_PCT` | Share of lot age that was monitored | Σ reading_min ÷ (last_reading_ts − harvest_ts) | lot | LOT_THERMAL_STATE | Evidence completeness | Forensics | Below the limit, shelf-life output is flagged LOW-COVERAGE |
| `THERMAL_EXPOSURE_DEG_H` | Degree-hours above the threshold | Σ degree_min_above ÷ 60 | lot × holder | LOT_CUSTODY_EXPOSURE | Severity | Forensics | **Not additive across lots.** The cross-lot aggregate is a kg-weighted mean only |
| `DATA_AGE_MIN` | Time since the last reading | now − last_reading_ts | lot | LOT_THERMAL_STATE | Staleness | All tools | Over the limit, tools return `STALE` and refuse to supply a value for a decision |
| `KG_IN_TRANSIT` | kg on shipments currently in transit | Σ shipment_lot.kg where state = IN_TRANSIT | shipment | SHIPMENT_LOT, SHIPMENT | Live exposure | — | Current-state metric. **Never used for historical decision analysis** |
| `RECEIPT_ACCEPTANCE_RATE` | Share of receipt inspections accepted | accepted ÷ receipt inspections (final per lot) | lot → product / customer | QC_INSPECTION | Outcome quality | Precedents | Only the *final* receipt inspection per lot counts; re-inspections don't double count |
| `INVENTORY_SNAPSHOT_AGE_H` | Age of the latest snapshot | now − max(snapshot_ts) | site | INVENTORY | ATP trustworthiness | Strategist (flag) | Above the limit, replacement-lot options are flagged STALE |

### Risk metrics
| Name | Definition | Formula | Grain | Source | Business meaning | Agent usage | Governance constraints |
|---|---|---|---|---|---|---|---|
| `REJECTION_RISK_PCT` | Probability the chosen option is rejected at receipt | P(SL at receipt < spec), from the prediction-error distribution | decision | Frozen (scorer) | Downside risk | Strategist | Error distribution comes from the calibration data in `SL_PREDICTION_MAE` |
| `EVIDENCE_COVERAGE_PCT` | Required evidence types present | present ÷ required (required per action from `GOV.PARAMETERS`) | decision | Frozen | Decision defensibility | Forensics, Claims | Below the minimum, FILE_CLAIM is not allowed (it DEFERs) |
| `EVIDENCE_CONFLICTS` | Conflicting document claims | COUNT DISTINCT conflicting claim_id | case | DOCUMENT_CONSISTENCY | Trust | Forensics | Counts distinct claims; repeated extraction doesn't inflate it |
| `DEADLINE_SLACK_MIN` | Time left when decided | deadline_ts − decided_at | decision | DECISION | Timeliness | — | Negative = fallback executed |
| `SL_PREDICTION_MAE_DAYS` / `SL_PREDICTION_BIAS_DAYS` | Model error at receipt | mean(abs(predicted − actual)) / mean(predicted − actual) | outcome → product | OUTCOME | Model trust | Strategist (model validity) | OBSERVED outcomes only. Bias is reported with its sign |

### Decision metrics
| Name | Definition | Formula | Grain | Source | Business meaning | Agent usage | Governance constraints |
|---|---|---|---|---|---|---|---|
| `CASES` | Excursion cases | COUNT DISTINCT case_id | case | CASE | Volume | — | DISTINCT, so bridge joins can't inflate it |
| `TIME_TO_DETECT_MIN` | Breach to case opened | MEDIAN(opened_at − first_breach_ts) | case | CASE | Detection speed | — | **Median** (heavy tails) |
| `TIME_TO_DECISION_MIN` | Case opened to final decision | MEDIAN(decided_at − opened_at) | decision | DECISION | Decision speed | — | Median; by decision point |
| `DEADLINE_MET_RATE` | Decided before the deadline | decisions with slack ≥ 0 ÷ decisions | decision | DECISION | Reliability | — | — |
| `DECISIONS` + share by `decider_kind` | Mix of RULE / AGENT / HUMAN / FALLBACK | COUNT ÷ total | decision | DECISION | How often the LLM is needed | — | Kills the "LLM everywhere" story with data |
| `HUMAN_OVERRIDE_RATE` | Approver chose differently | (ALTERNATIVE_CHOSEN + REJECTED) ÷ decided approvals | approval | APPROVAL | Trust in recommendations | — | — |
| `APPROVAL_LATENCY_MIN` | Request to verdict | MEDIAN(decided_at − requested_at) | approval | APPROVAL | Governance friction | — | Median |
| `AUDITOR_FAIL_RATE` | AI artifacts blocked | FAIL ÷ audited | decision | DECISION | AI faithfulness | — | — |
| `BEAT_DEFAULT_RATE` | Decisions that beat inaction | sealed cases with VALUE_PROTECTED ≥ 0 ÷ sealed cases | case | Derived | Decision quality | — | SEALED only |

### Financial metrics
| Name | Definition | Formula | Grain | Source | Business meaning | Agent usage | Governance constraints |
|---|---|---|---|---|---|---|---|
| `REALIZED_SALE_VALUE_USD` | Actual sale value after disposition | Σ invoiced value of the disposed kg | outcome | OUTCOME | Salvage realized | Claims (loss computation) | Invoiced values only, never order values |
| `INCREMENTAL_COST_USD` | Costs caused by the decision | Σ actual_cost of ACKED actions | action → decision | ACTION | Cost of recovery | Claims | **ACKED actions only.** Queued or failed actions count 0 |
| `PENALTIES_USD` | Customer penalties incurred | Σ penalties on affected lines | outcome | OUTCOME | Commercial cost | — | Affected lines only |
| `CLAIMED_USD` | Amount filed | Σ amount where status ≥ FILED | claim | CLAIM | Recovery sought | Claims (history) | Never added to RECOVERED |
| `RECOVERED_USD` | Amount actually paid | Σ paid_amount | claim | CLAIM | Recovery realized | Claims (history) | Cash basis: PAID status only |
| `CLAIM_RECOVERY_RATE` | Recovery on closed claims | RECOVERED ÷ CLAIMED, closed claims only | claim → counterparty | CLAIM | Recovery effectiveness | Claims (counterparty history) | **Closed claims only.** Open claims would deflate it |
| `NRV_PREDICTION_GAP_USD` (D) | Realized vs predicted | REALIZED_NRV − PREDICTED_NRV | case | Derived | Scorer calibration | — | SEALED only |

## Hazards and protections
| Hazard | Where it bites | Protection |
|---|---|---|
| **Time-dependent parameters** | Recomputing old decisions with new Q10, prices or specs | Decision metrics read **frozen** values (packs, CASE_LOTS, DECISION). Live metrics use current values. The two are separate entities, so they can't be mixed in one query |
| **Inventory snapshots** | Summing stock across dates (3.5× overstatement in the baseline) | `NON ADDITIVE BY snapshot_ts`; snapshot-age guard; stock_status split (IN_TRANSIT is never AVAILABLE) |
| **Shipment state** | Joining historical decisions to *today's* shipment state | DECISION carries `shipment_state_at_decision`. Current state only feeds live metrics |
| **Quality state** | Several receipt inspections per lot | OUTCOME uses the **final** receipt inspection. RECEIPT_ACCEPTANCE uses one per lot |
| **Financial state** | Adding claimed + recovered; counting open claims; using provisional NRV | Separate status-based metrics; closed-only rate; `_PROVISIONAL` vs final; VALUE_PROTECTED on SEALED only |
| **Semi-additive physics** | Summing degree-hours or shelf life across lots | Physics pre-aggregated per lot in DTs; cross-lot aggregates are kg-weighted means only |
| **Double counting via bridges** | Lot ↔ shipment ↔ case many-to-many | Metrics defined on the bridge (SHIPMENT_LOT, CASE_LOT); many-to-one-only relationships; COUNT DISTINCT; **one open case per lot** invariant |
| **Reefer fan-out** | One air reading applied to every lot on the trailer | Lot physics uses the **PRIMARY pulp probe**; reefer air is a flagged proxy only when no probe exists; shipment-level reefer measures use MAX, not SUM |
| **Duplicate probes** | Two probes on one lot doubling the reading minutes | One PRIMARY assignment per lot per interval (an invariant on `DEVICE_ASSIGNMENTS`) |
| **Event duplication** | Retries re-delivering readings or SAP records | MERGE on idempotency key at the sink; uniqueness tests on (device, reading_ts) and idempotency_key; typed DTs keep the latest version per entity |
| **Late or out-of-order events** | Custody events arriving after a decision | Replay uses `received_at ≤ as_of`. Late facts touching an open case set `needs_reassessment`; sealed decisions keep their frozen pack |
| **Stale data** | Deciding on old telemetry or snapshots | DATA_AGE and snapshot-age metrics. Tools return `STALE` over the limit; feasibility uses p90 transit; the evidence pack records data age |
| **Option alternatives** | Summing NRV across mutually exclusive options | OPTIONS is not a logical table; only the chosen and default values exist in the model |
| **Units and currency** | Mixing °C/°F, kg/lb or currencies | Units in metric names; one currency (USD) enforced in REF; fixed-precision types |

## Why an agent can't easily produce a mathematically incorrect answer
1. **Agents never write SQL.** No text-to-SQL. Every number arrives through a tool that queries `SEMANTIC_VIEW()` with an **allow-list** of (metric, dimensions, filters) combinations from `GOV.METRIC_REGISTRY`.
2. **Self-describing values.** Every tool value comes back as `{name, value, unit, grain, as_of, data_age, freshness: OK|STALE, metric_version}`. The agent always knows what a number is, and how old it is.
3. **Grain-locked model.** Primary keys, many-to-one relationships only, and physics pre-aggregated to the right grain make fan-out and cross-lot sums structurally unavailable.
4. **Semi-additive declarations** on snapshots.
5. **Frozen decision values.** History can't be silently restated with today's parameters.
6. **No option aggregation.** Alternatives can't be summed.
7. **Ingestion invariants.** Duplicates are stopped at ingestion and checked by uniqueness tests: one open case per lot, one primary probe per lot.
8. **Agents don't compute.** `SUBMIT_*` rejects any number in a rationale that doesn't match a tool-supplied value. The Auditor rechecks the statements built on those numbers.
9. **Formula parity and single definition.**
   - The scorer (Python) and the semantic view share the NRV component definitions.
   - A test applies the scorer formula to the realized components and asserts it equals `REALIZED_NRV`.
   - A test asserts each canonical metric is defined exactly once (definition hash in the registry).
10. **For human analysts using Cortex Analyst** (not agents): `AI_SQL_GENERATION` instructions and verified queries forbid summing options, summing physics across lots, or summing inventory across snapshots.

## Amendments to the Phase 8 inventory
| Change | Object | Why |
|---|---|---|
| +2 Dynamic Tables | `OPS.LOT_THERMAL_STATE` (lot), `OPS.LOT_CUSTODY_EXPOSURE` (lot × holder) | Pre-aggregate the physics at the correct grain |
| +1 view | `CASE.V_DECISIONS` | The decision entity |
| +1 table | `GOV.METRIC_REGISTRY` | Canonical metric governance and tool allow-lists |

New totals: **35 tables, 14 Dynamic Tables, 3 views.**

---

# Phase 10 — Agent Tool Contracts

## Global contract (applies to every tool)
1. **No unrestricted access.**
   - No SQL tool, no generic query tool, no text-to-SQL.
   - The agent role has **zero table privileges**. It can only `USAGE` the tool procedures bound to it.
   - Execution, approval and acknowledgement procedures are *not* agent tools.
2. **Case-scoped capability (`run_id`).**
   - Before invoking an agent, the engine calls `API.START_AGENT_RUN(case_id, agent, decision_point, provider, model)`.
   - That returns a `run_id` bound to agent + case + decision point + tool allow-list + call budget + expiry.
   - Every tool rejects calls whose `run_id` is missing, expired, or bound to a different case or agent.
   - **An agent can only see the case it is working on.**
3. **Evidence provenance.**
   - Every item a tool returns carries an `evidence_id`. Formats:
     - `EV:PACK:<pack>#<path>`
     - `EV:TEL:<lot>:<from>-<to>:<res>`
     - `EV:DOC:<doc>#<claim>`
     - `EV:SIG:<test>@<rule_ver>`
     - `EV:OPT:<option>`
     - `EV:PREC:<case>`
     - `EV:CTR:<contract>@v<n>#<clause>`
   - Submissions may cite **only IDs returned to the same run** (logged in `CASE.TOOL_CALLS`) or present in the case's evidence pack.
4. **As-of consistency.**
   - All reads are filtered to the evidence pack's `as_of` (`received_at ≤ as_of`; reference versions valid at `as_of`; precedents sealed before `as_of`).
   - So an agent's view is reproducible on replay.
5. **Untrusted text.**
   - Third-party text (incident notes, correspondence, account notes, clause text) is returned inside `{"untrusted_text": ...}`, length-capped.
   - Instructions treat it as data only. This is a prompt-injection defense, and the Auditor re-checks it.
6. **Standard output envelope:**
   ```
   {status: OK|PARTIAL|STALE|INVALID|DENIED|ERROR, tool, tool_version, run_id, case_id, as_of,
    data:{...}, values:[{name, value, unit, grain, as_of, data_age_min, freshness, metric_version, evidence_id}],
    evidence_ids:[...], warnings:[...], errors:[{code, path, message}], result_hash}
   ```
7. **Budgets.** Per-run call budget (e.g. 40), row caps per call, text caps. Going over returns `DENIED: BUDGET`.
8. **Binding constraint (Cortex generic tools).**
   - Every parameter is required. Optional values use sentinels: `''`, `0`, `'[]'`.
   - Complex inputs are **JSON-encoded strings**, decoded and validated server-side. The schemas below show the decoded shape.
9. **Audit.**
   - **Every call** appends one row to `CASE.TOOL_CALLS`: `run_id, seq, tool, args_hash, result_hash, evidence_ids, status, latency_ms`. The tool writes this row itself, so the agent can't skip it.
   - Writes also produce ledger entries.
10. **Shared implementation.** One Python toolkit is staged as a package and imported by every tool procedure. It contains:
    - `capability` (run checks);
    - `envelope`;
    - `evidence_ids`;
    - `validators` (JSON Schema + business rules, **the same code for dry-run and submit**);
    - `audit`.

## READ tools
### R1 `GET_CASE_CONTEXT`
- **Purpose:** the situation for the current decision point: case header, lots with frozen canonical metrics, custody timeline, affected order lines + specs, escalation reasons, deadline, latest finding, and (for D2) counterparty responses.
- **Input:** `{run_id: str, case_id: str, sections: [enum HEADER|LOTS|CUSTODY|ORDERS|FINDING|ESCALATION|RESPONSES|ALL]}`
- **Output:** `data{case{state, dp, severity, opened_at, deadline_ts, holder_at_onset}, lots[{lot_id, product, kg, values[REMAINING_SHELF_LIFE_DAYS, MONITORING_COVERAGE_PCT, TEMPERATURE_COMPLIANCE_PCT, PLANNED_VALUE_USD, VALUE_AT_RISK_USD]}], custody[{holder, from, to}], orders[{line_id, customer, tier, kg, min_sl_days, eta}], finding{…}, escalation_reasons[], responses[{response_id, type, amount, untrusted_text}]}`, plus `pack_revision`.
- **Allowed agents:** Forensics, Strategist, Claims.
- **Read/write:** read; audit row only.
- **Validation:** capability; section enum.
- **Idempotency:** a pure read of the frozen pack. The same pack revision gives the same `result_hash`.
- **Failure:** `DENIED` if the case isn't bound to the run; `ERROR: ASSESSMENT_NOT_READY`.
- **Audit:** TOOL_CALLS row including the pack revision.

### R2 `GET_TELEMETRY_WINDOW`
- **Purpose:** time-series evidence for one lot, or for its shipment's reefer.
- **Input:** `{run_id, case_id, lot_id: str, from_ts: ts, to_ts: ts, resolution: enum RAW|BUCKET_15M|BUCKET_60M, channels: [enum PULP|SUPPLY_AIR|RETURN_AIR|SETPOINT|DOOR|ALARM|MODE]}`
- **Output:** `data{series[{ts, holder, <channel values>, proxy_flag}], gaps[{from, to}], summary{max_pulp_c, breach_min, n_points}}`. One `EV:TEL` id per window.
- **Allowed agents:** Forensics, Claims.
- **Read/write:** read.
- **Validation:**
  - the lot must belong to the case;
  - the window must lie within harvest … pack `as_of` (no peeking past the evidence);
  - point cap of 2,000; RAW resolution only for windows ≤ 6 h.
- **Idempotency:** deterministic (as-of filter).
- **Failure:** `INVALID` with a suggested resolution if the window is too large. No data returns `OK` with gaps.
- **Audit:** TOOL_CALLS.

### R3 `GET_DOCUMENT_EVIDENCE`
- **Purpose:** documents linked to the case, with extracted claims, consistency verdicts, narratives and sensor metadata.
- **Input:** `{run_id, case_id, doc_types: [enum INSPECTION_CERT|BOL|RECEIVING_REPORT|REEFER_DOWNLOAD|INCIDENT_NOTE|CLAIM_CORRESPONDENCE], include_narratives: bool}`
- **Output:** `data{documents[{doc_id, type, source, received_at, sha256, claims[{claim_key, value, unit, claimed_ts, consistency{verdict, sensor_value, delta, rule_id}}], narrative{untrusted_text}}], sensors[{device_id, role, placement, calibration_date}], pending_extraction[]}`
- **Allowed agents:** Forensics, Claims.
- **Read/write:** read.
- **Validation:** documents received ≤ `as_of`; narrative cap of 4,000 characters.
- **Idempotency:** deterministic.
- **Failure:** `PARTIAL` if extraction is still pending (the pending list is returned).
- **Audit:** TOOL_CALLS.

### R4 `GET_PARTY_CONTEXT`
- **Purpose:** customer and counterparty context.
- **Input:** `{run_id, case_id, party_id, aspects: [enum PROFILE|SPECS|CONTRACT_TERMS|CLAUSE_TEXT|PENALTIES|ACCOUNT_NOTES|CLAIM_HISTORY|RECENT_INCIDENTS]}`
- **Output:** `data{party{id, type, tier}, contract{contract_id, version, terms{liability_cap_usd, claim_window_days, claim_min_usd, temp_clause, precool_clause}, clauses[{clause_id, untrusted_text}]}, penalties[…], notes{untrusted_text}, claim_history{closed, recovery_rate, common_defenses[]}, recent_incidents{count_90d}}`
- **Allowed agents (per aspect):**
  - Strategist: PROFILE, SPECS, PENALTIES, ACCOUNT_NOTES, RECENT_INCIDENTS.
  - Claims: all aspects.
- **Read/write:** read.
- **Validation:** **the party must be related to the case** (customer on an affected line, the shipment's carrier, or the lot's grower). Aspects must be on that agent's allow-list.
- **Idempotency:** versions valid at `as_of`.
- **Failure:** `DENIED` for an unrelated party or a disallowed aspect.
- **Audit:** TOOL_CALLS.

### R5 `GET_SCORED_OPTIONS`
- **Purpose:** the scored option set for the current decision point.
- **Input:** `{run_id, case_id, include_infeasible: bool, include_variants: bool}`
- **Output:** `data{option_set_rev, scorer_version, options[{option_id, kind, bundle{lots[{lot_id, disposition, destination}], order_recovery[], financial_action}, feasible, infeasibility_reasons[], expires_at, is_default, is_fallback, values[PREDICTED_NRV_USD, REJECTION_RISK_PCT, SPEC_MARGIN_DAYS, expected INCREMENTAL_COST_USD, expected PENALTIES_USD], dominance{rank, dominated_by[]}}]}`
- **Allowed agents:** Strategist (D1), Claims (D2).
- **Read/write:** read.
- **Validation:** the decision point must match the agent.
- **Idempotency:** keyed by `option_set_rev`.
- **Failure:** `ERROR: OPTIONS_NOT_READY`.
- **Audit:** TOOL_CALLS.

### R6 `GET_ARTIFACT_FOR_AUDIT`
- **Purpose:** an artifact plus its resolved citations, for verification.
- **Input:** `{run_id, artifact_id}`
- **Output:** `data{artifact{type, author_agent, author_model, text, fields}, citations[{evidence_id, resolved{kind, value|excerpt, source}}], unresolved_citations[], numeric_spans[{span, value}], author_tool_values[{name, value, evidence_id}]}`. The numeric spans are extracted deterministically.
- **Allowed agents:** Auditor only.
- **Read/write:** read.
- **Validation:** the artifact must be AUDIT_PENDING. **The auditor's model must differ from the author's** whenever `GOV.MODEL_REGISTRY` requires independence.
- **Idempotency:** pure.
- **Failure:** `DENIED` if independence is violated.
- **Audit:** TOOL_CALLS.

## ANALYSIS tools (deterministic computation; agents interpret)
### A1 `ANALYZE_CAUSAL_SIGNATURES`
- **Purpose:** compute the physical indicators that support or contradict each candidate cause. The agent weighs computed indicators instead of eyeballing raw series.
- **Input:** `{run_id, case_id, lot_id, tests: [enum WARM_LOADING|PRECOOL_DELAY|SETPOINT_MISMATCH|REEFER_PULLDOWN_FAILURE|DEFROST_ARTIFACT|DOOR_EVENTS|DOCK_DWELL|SENSOR_FAULT]}`
- **Output:** `data{results[{test, indicators{…}, verdict: SUPPORTS|CONTRADICTS|INCONCLUSIVE, rule_id, rule_version}]}`. Example indicators:
  - pulp at loading vs setpoint;
  - supply/return delta trend;
  - door-open minutes inside the breach window;
  - dwell at handoff;
  - flatline or jump detection.
- **Allowed agents:** Forensics, Claims (to anticipate the counterparty's defenses).
- **Read/write:** read.
- **Validation:** the lot must belong to the case. Thresholds come from `GOV.PARAMETERS` (versioned).
- **Idempotency:** deterministic (as-of).
- **Failure:** `INCONCLUSIVE` with a reason when data is insufficient.
- **Audit:** TOOL_CALLS + rule versions.

### A2 `GET_PRECEDENTS`
- **Purpose:** structurally similar sealed cases, with their decisions and outcomes. **This is not RAG.**
- **Input:** `{run_id, case_id, focus: enum DISPOSITION|CAUSATION|CLAIM, k: int 1–10}`
- **Output:** `data{method: "feature-match@v1", precedents[{case_ref, similarity, matched_features{product, holder_type, exposure_band, sl_band, tier, cause}, decision{action_kind, decider_kind}, outcome{value_protected_usd, sl_error_days, claim_result}}]}`
- **Allowed agents:** Forensics, Strategist, Claims.
- **Read/write:** read.
- **Validation:** sealed cases only, sealed before `as_of`; excludes the current case; k ≤ 10.
- **Idempotency:** deterministic.
- **Failure:** an empty result returns `OK`.
- **Audit:** TOOL_CALLS.

### A3 `GET_MODEL_VALIDITY`
- **Purpose:** whether the shelf-life model can be trusted for this lot's conditions.
- **Input:** `{run_id, case_id, lot_id}`
- **Output:** `data{param_version, validity: IN_RANGE|EXTRAPOLATING|UNCALIBRATED, reasons[], recent_mae_days, recent_bias_days, n_outcomes, coverage_pct}`
- **Allowed agents:** Strategist, Forensics.
- **Read/write:** read.
- **Validation:** the lot must belong to the case.
- **Idempotency:** deterministic.
- **Failure:** `UNCALIBRATED` if no outcomes exist.
- **Audit:** TOOL_CALLS.

### A4 `COMPUTE_CLAIM_BASIS`
- **Purpose:** the deterministic claim basis: loss, cap, claimable amount, filing deadline, prerequisite checks and required documents.
- **Input:** `{run_id, case_id, counterparty_id, basis: enum CARRIER_TEMPERATURE|GROWER_PRECOOL|GROWER_QUALITY}`
- **Output:** `data{loss{planned_value_usd, realized_salvage_usd, incremental_cost_usd, total_loss_usd, provisional: bool}, cap_usd, claimable_usd, deadline{filing_due_ts, days_remaining}, prerequisites[{id: NOTICE_TIMELY|MITIGATION_EVIDENCED|SETPOINT_ON_BOL|CUSTODY_PROVEN|DOCS_COMPLETE, satisfied}], required_docs[{type, present, doc_id}]}`
- **Allowed agents:** Claims.
- **Read/write:** read.
- **Validation:** the counterparty must be related to the case, and the basis must be allowed by that party's contract type.
- **Idempotency:** deterministic.
- **Failure:** `OK` with `provisional = true` until the outcome is final.
- **Audit:** TOOL_CALLS.

## SIMULATION tools (deterministic what-ifs; agents never compute numbers themselves)
### S1 `SIMULATE_OPTION_VARIANTS`
- **Purpose:** check robustness, and evaluate bounded variants of the options.
- **Input:** `{run_id, case_id, base_option_ids: [str] (≤5), scenarios: [{scenario_id, kind: enum PREDICTION_ERROR|ETA_SHIFT|SPLIT|ALT_DESTINATION, params: object}] (≤6)}`
- **Output:** `data{results[{base_option_id, scenario_id, variant_option_id|null, feasible, values[PREDICTED_NRV_USD, REJECTION_RISK_PCT, SPEC_MARGIN_DAYS], delta_vs_base}], robustness{top_choice_stable: bool, flips_under: [scenario_id]}}`
- **Allowed agents:** Strategist.
- **Read/write:**
  - PREDICTION_ERROR and ETA_SHIFT are evaluated only and not stored.
  - SPLIT and ALT_DESTINATION **store** a variant option (`origin = AGENT_VARIANT`, `parent_option_id`), which can then be chosen.
- **Validation:**
  - parameter ranges come from GOV (e.g. error ±3 days, ETA shift ≤ 24 h);
  - ALT_DESTINATION must be in the generator's **candidate destination list**, so the agent can't invent destinations;
  - SPLIT quantities must sum to the lot's kg;
  - hard limits are re-applied.
- **Idempotency:** the key is `hash(run_id, base_option_id, scenario)`. A retry returns the same `variant_option_id`.
- **Failure:** `INVALID` with the allowed ranges. An infeasible variant comes back with `feasible = false`.
- **Audit:** TOOL_CALLS; stored variants also get an OPTIONS_SCORED ledger entry.

### S2 `SIMULATE_CLAIM_VARIANTS`
- **Purpose:** claim-amount variants and their expected recovery.
- **Input:** `{run_id, case_id, counterparty_id, basis, variants: [enum FULL|CAPPED|SETTLEMENT_BAND]}`
- **Output:** `data{variants[{variant_option_id, amount_usd, expected_recovery_usd, recovery_probability, settlement_band{min, max}}]}`
- **Allowed agents:** Claims.
- **Read/write:** stores the variants as D2 options (`AGENT_VARIANT`).
- **Validation:**
  - amounts can never exceed `claimable_usd` or the cap;
  - the settlement band comes from GOV;
  - recovery probability comes from counterparty history (deterministic).
- **Idempotency:** hash key.
- **Failure:** `INVALID` if there's no claimable basis.
- **Audit:** TOOL_CALLS + ledger.

## RECOMMENDATION tools (write proposals only, never operational state)
### C1 `SUBMIT_CAUSATION_FINDING`
- **Purpose:** record the Forensics finding.
- **Input:** `{run_id, case_id, finding{hypotheses[{cause: enum, verdict: SUPPORTED|REJECTED|INCONCLUSIVE, evidence_ids[]}], most_likely_cause: enum, responsible_parties[{party_id, basis: enum, evidence_ids[]}], evidence_trust[{evidence_id, trust: HIGH|MEDIUM|LOW, reason}], sufficiency: SUFFICIENT|INSUFFICIENT, gaps[{description, closing_evidence_type}], confidence: HIGH|MEDIUM|LOW, confidence_reasons[], narrative: str ≤ 3,000}}`
- **Output:** `{status: ACCEPTED|REJECTED, finding_id, validation_errors[], server_adjustments[], next_state}`
- **Allowed agents:** Forensics.
- **Read/write:** **write** to `CASE.CAUSATION_FINDINGS` (an append-only revision) + ledger FINDING + state change to `AUDIT_PENDING`.
- **Validation:**
  - the state must be FORENSICS_PENDING;
  - JSON Schema;
  - **cited IDs must be ones this run has seen**;
  - responsible parties **must be custody holders of the case lots**;
  - the most likely cause must be SUPPORTED;
  - confidence is **capped by deterministic evidence coverage**, and the cap is reported as an adjustment;
  - numbers in the narrative must match tool values.
- **Idempotency:** server key = `hash(run_id, payload)`. A duplicate returns the same `finding_id`. A second, different payload is accepted only after a REJECTED one.
- **Failure:** REJECTED with errors → the engine allows one retry → then the deterministic attribution is used, flagged `UNADJUDICATED`.
- **Audit:** ledger entry with payload + validation result.

### C2 `SUBMIT_RECOMMENDATION`
- **Purpose:** record the Strategist's D1 choice.
- **Input:** `{run_id, case_id, recommendation{option_id, rejected_alternatives[{option_id, reason}], trade_off: str, robustness{stable: bool, s1_call_seqs[]}, would_change_if: str, deviation_reason: str, confidence, confidence_reasons[], citations[]}}`
- **Output:** `{status, rec_id, validation_errors[], next_state: AUDIT_PENDING}`
- **Allowed agents:** Strategist.
- **Read/write:** write `CASE.RECOMMENDATIONS` + ledger + state change.
- **Validation:**
  - the state must be STRATEGY_PENDING;
  - the option must be in the current set (variants from this run included), **feasible**, and **unexpired at now + approval buffer**;
  - hard limits are re-checked;
  - **`rejected_alternatives` must cover every non-dominated option**, which forces an explicit comparison;
  - `deviation_reason` is **required if the choice isn't the top NRV**;
  - `stable = true` must reference **S1 calls actually made in this run**;
  - citations must have been seen by this run;
  - numbers must match tool values.
- **Idempotency:** payload hash per run.
- **Failure:** REJECTED → one retry → then the scorer's top option, flagged `AI_UNAVAILABLE`, which always needs approval.
- **Audit:** ledger RECOMMENDATION.

### C3 `SUBMIT_CLAIM_RECOMMENDATION`
- **Purpose:** record the Claims & Recovery decision: a D1 notice, D2 settlement, or a reply to the counterparty.
- **Input:** `{run_id, case_id, claim_rec{action: enum CLAIM_NOTICE|FILE_CLAIM|GROWER_DEDUCTION|ABSORB|DEFER|ACCEPT_OFFER|COUNTER|APPEAL, counterparty_id, basis, variant_option_id, prerequisites_ack[], anticipated_defenses[{defense: enum, rebuttal, evidence_ids[]}], letter_draft: str ≤ 6,000, response_to: str, confidence, citations[]}}`
- **Output:** `{status, rec_id, validation_errors[], next_state: AUDIT_PENDING}`
- **Allowed agents:** Claims.
- **Read/write:** write recommendation + ledger + state change.
- **Validation:**
  - the action must be allowed for this basis and counterparty;
  - **the amount comes only from `variant_option_id`** (no free amounts);
  - FILE_CLAIM requires a SUFFICIENT finding with confidence ≥ MEDIUM, all A4 prerequisites satisfied and the deadline not passed;
  - COUNTER and ACCEPT must fall inside the policy band;
  - numbers and citations in the letter must match tool values / seen evidence.
- **Idempotency:** payload hash per run.
- **Failure:** REJECTED → one retry → DEFER and route to a human in Finance (the deadline guard stays independent).
- **Audit:** ledger RECOMMENDATION.

## MUTATION tools (the only operational write an agent can trigger)
### M1 `REQUEST_EVIDENCE`
- **Purpose:** ask a party for missing evidence (reefer download, BOL copy, re-inspection, photos, temperature-recorder file).
- **Input:** `{run_id, case_id, request{evidence_type: enum, from_party_id, reason: str ≤ 500, needed_by_ts}}`
- **Output:** `{status: QUEUED|PENDING_APPROVAL|DENIED|DUPLICATE, action_id, policy_outcome}`
- **Allowed agents:** Forensics, Claims.
- **Read/write:** **write.** The tool runs `EVALUATE_POLICY` for the REQUEST_EVIDENCE action type (e.g. document requests AUTO; a paid re-inspection above $X needs QUALITY_MGR approval), then inserts a `CASE.ACTIONS` row. Dispatch is done by the governed executor, not the agent.
- **Validation:**
  - the party must be related to the case;
  - the evidence type must be allowed for that party;
  - `needed_by` must be ≤ the case deadline;
  - at most 3 requests per case per type.
- **Idempotency:** the natural key `(case, type, party)` while a request is open. A duplicate returns `DUPLICATE` with the existing `action_id`.
- **Failure:** `DENIED` with a reason.
- **Audit:** ledger POLICY_EVALUATION + ACTION_QUEUED.

**Agents have no other mutation tools.** Re-routes, stock blocks, order changes, notices, claims and deductions are executed only by `CASE.COMMIT_EXECUTION`, after governance and approval, and never by an agent.

## GOVERNANCE tools
### G1 `VALIDATE_SUBMISSION`
- **Purpose:** a dry run of C1–C3. It returns every error and server adjustment the real submit would produce, without writing anything.
- **Input:** `{run_id, case_id, submission_type: enum FINDING|RECOMMENDATION|CLAIM_RECOMMENDATION, payload: object}`
- **Output:** `{valid: bool, errors[{code, path, message}], warnings[], server_adjustments[{field, from, to, reason}]}`
- **Allowed agents:** Forensics, Strategist, Claims.
- **Read/write:** read (audit row only).
- **Validation:** **the same validator code path as the submit tools.**
- **Idempotency:** pure.
- **Failure:** —
- **Audit:** TOOL_CALLS.

### G2 `SUBMIT_AUDIT_VERDICT`
- **Purpose:** the Auditor's verdict on an artifact.
- **Input:** `{run_id, artifact_id, verdict{statements[{span, statement, verdict: SUPPORTED|UNSUPPORTED|CONTRADICTED, evidence_ids[]}], overall: PASS|FAIL, required_fixes[]}}`
- **Output:** `{status, verdict_id, next_state}`. PASS → EVALUATE_POLICY. FAIL → back to the author once, then to a human.
- **Allowed agents:** Auditor.
- **Read/write:** write the verdict + ledger AUDIT_VERDICT + state change.
- **Validation:**
  - any CONTRADICTED statement forces FAIL;
  - **every number-bearing or factual sentence must be covered** (deterministic sentence split), so a lazy PASS is impossible;
  - the model must be independent of the author.
- **Idempotency:** one verdict per artifact revision. A duplicate returns the same `verdict_id`.
- **Failure:** invalid → one retry → the artifact is marked `UNVERIFIED`: it can't be sent outside, and internally it needs a human.
- **Audit:** ledger.

## Agent × tool matrix
| Tool | Forensics | Strategist | Claims | Auditor |
|---|---|---|---|---|
| R1 GET_CASE_CONTEXT | ✓ | ✓ | ✓ | |
| R2 GET_TELEMETRY_WINDOW | ✓ | | ✓ | |
| R3 GET_DOCUMENT_EVIDENCE | ✓ | | ✓ | |
| R4 GET_PARTY_CONTEXT | | ✓ (limited aspects) | ✓ | |
| R5 GET_SCORED_OPTIONS | | ✓ (D1) | ✓ (D2) | |
| R6 GET_ARTIFACT_FOR_AUDIT | | | | ✓ |
| A1 ANALYZE_CAUSAL_SIGNATURES | ✓ | | ✓ | |
| A2 GET_PRECEDENTS | ✓ | ✓ | ✓ | |
| A3 GET_MODEL_VALIDITY | ✓ | ✓ | | |
| A4 COMPUTE_CLAIM_BASIS | | | ✓ | |
| S1 SIMULATE_OPTION_VARIANTS | | ✓ | | |
| S2 SIMULATE_CLAIM_VARIANTS | | | ✓ | |
| C1 SUBMIT_CAUSATION_FINDING | ✓ | | | |
| C2 SUBMIT_RECOMMENDATION | | ✓ | | |
| C3 SUBMIT_CLAIM_RECOMMENDATION | | | ✓ | |
| M1 REQUEST_EVIDENCE | ✓ | | ✓ | |
| G1 VALIDATE_SUBMISSION | ✓ | ✓ | ✓ | |
| G2 SUBMIT_AUDIT_VERDICT | | | | ✓ |

**No policy-preview tool is offered, on purpose.** It would let an agent pick options to *avoid* approval. Approval latency is already built into option expiry, deterministically.

## Implementation notes
- **Form:** each tool is a Python stored procedure in the `AGENT` schema: `RETURNS VARIANT`, `EXECUTE AS OWNER`, importing the shared toolkit.
- **Who builds what:**
  - **Claude** writes the toolkit, the JSON Schemas and the business-rule validators, with unit tests.
  - **CoCo** creates the procedures, grants `USAGE` to `BBC_AGENT_RUNTIME`, and binds each agent to its tool subset (`tool_resources.identifier`, `type: procedure`).

**Amendments to the Phase 8 inventory:**
| Change | Detail |
|---|---|
| Tools | 14 → **18** (+A1, +A3, +S2, +G1; GET_CLAIM_CONTEXT replaced by A4 + S2) |
| +1 table | `CASE.TOOL_CALLS` |
| API procedures | `RECORD_AGENT_RUN` replaced by `START_AGENT_RUN` (issues the capability) + `END_AGENT_RUN` |

---

# Phase 11 — Decision Evaluation Engine

## Principle
- An event **never** triggers an action directly.
- The engine enumerates possible actions, simulates each one's consequences, removes the ones that violate constraints, values the rest, and only then recommends.
- **Every number is computed by deterministic, versioned, seeded code from governed inputs.**
- The LLM can choose and explain. It cannot calculate.

## Pipeline (all inside `CASE.GENERATE_AND_SCORE_OPTIONS`, using Python package `bbc_engine`)
| Stage | Computes | Method | Kind |
|---|---|---|---|
| E1 State estimate | Remaining shelf life now, with uncertainty | Canonical metric + calibration residuals (σ) | Deterministic |
| E2 Action space | Candidate option bundles | Enumerate dispositions × destinations; solver for order recovery; prune | Deterministic |
| E3 Hard constraints | Eliminated options + reason codes | Rule table (GOV, REF) | Deterministic |
| E4 Outcome simulation | Arrival shelf life, acceptance, delivery, timing | **Seeded Monte Carlo** (N = 2,000 per option) | Deterministic |
| E5 Valuation | Revenue, costs, penalties, expected recovery, NRV distribution | Formulas over REF prices / costs / contracts | Deterministic |
| E6 Impact vectors | Customer, logistics and inventory impact; confidence | Formulas + policy thresholds | Deterministic |
| E7 Ranking | Risk-adjusted score, dominance, margin between the top two | Policy objective (λ, κ from GOV) | Deterministic |
| E8 Routing | Rule decision, or escalation with reason codes | `ROUTE` (GOV.ROUTER_RULES) | Deterministic |
| E9 Decision Brief | Answers to the six questions | Assembled from E1–E8; **rule decisions get a template explanation** | Deterministic |
| E10 (escalated only) | Choice among the non-dominated options + the "why" | Recovery Strategist, using only Brief values and S1 what-ifs | **AI** |

## E2 · Action space
- **Per lot, disposition is one of:**
  - CONTINUE (as planned);
  - EXPEDITE (a faster mode on the lane, if one exists);
  - REROUTE(d), for d in the **candidate destinations**: reachable sites with open demand or a spot channel, within the maximum detour;
  - DOWNGRADE(processor);
  - INSPECT (at the next node; valued as **value of information**, see E4);
  - DISPOSE (donate or dump).
- **Order recovery per bundle:**
  - The engine solves for the best recovery of the affected lines with an assignment MILP (`scipy.optimize.milp`): FILL_FROM(replacement lot, site), SHORT, or REPROMISE(date).
  - It minimizes cost + penalties subject to specs and quality-adjusted ATP.
  - One extra "short instead of fill" alternative is kept for comparison.
- **Financial action:**
  - In D1, CLAIM_NOTICE is attached automatically when an external party's `EXCESS_LIFE_SHARE` ≥ the threshold. Notice is cheap and preserves rights.
  - In D2, the options are FILE / DEDUCT / ABSORB / DEFER × amount variants.
- **Always present:**
  - **DEFAULT** = "do nothing": the current plan continues and no recovery actions are taken.
  - **FALLBACK** = the safe hold / INSPECT.
- **Pruning:** keep the top 12 by score among feasible options, plus every option that isn't dominated, plus DEFAULT and FALLBACK.

## E4–E6 · Outcome model per option
Notation:
- per lot ℓ: kg, planned price p_plan, planned value PV = kg × p_plan;
- `rate(T) = Q10^((T−Tref)/10)`.

| Dimension | Output | Formula / method | Inputs (source) |
|---|---|---|---|
| **State** | SL_now ~ N(μ, σ) | μ = `REMAINING_SHELF_LIFE_DAYS`. σ comes from calibration residuals (`SL_PREDICTION_MAE`); if there are too few outcomes, the prior σ in PRODUCTS is used | Evidence pack, OUTCOMES, REF.PRODUCTS |
| **Transit** | H_d (hours to destination) ~ LogNormal fitted to the p50 / p90 | Current position → destination lane | REF.LANES, shipment status |
| **Temperature during transit** | T scenario | Reefer OK → setpoint. Fault persists → T_fault (recent pulp trend, capped). P(fault persists) = π from GOV (raised if an alarm is still active). Transload / expedite → setpoint after the transfer | Telemetry, GOV.PARAMETERS |
| **Operational** | SL_arrival, P(accept), expected kg delivered, ETA p50 / p90 | SL_arrival = SL_now − H_d × rate(T)/24 − handling_h × rate(T_handling)/24. **Accept** ⇔ SL_arrival ≥ spec_min_d ∧ T_arrival ≤ spec_max | REF.CUSTOMER_SPECS |
| **Revenue** | E[revenue] | accepted × kg × price_d + rejected × salvage_reject. salvage_reject = kg × p_processor − return freight (or −disposal cost if the processor's minimum isn't met) | REF.CHANNEL_PRICES, contracts, REF.COST_RATES |
| **Recovery cost** | C | Δfreight (new lane − remaining planned) + expedite premium + inspection + transload + disposal + replacement transfer and handling (from the solver) | REF.LANES, **REF.COST_RATES** |
| **Customer impact** | Lines affected, P(on-time-in-full) per line, tier-A shortfall kg, penalties | Contract penalty terms applied to each simulated delivery outcome, after the solver's recovery plan | REF.CONTRACTS, ORDER_LINES |
| **Logistics impact** | Added hours and miles, carrier change, new dock appointments | Lane deltas | REF.LANES |
| **Inventory impact** | ATP consumed by site, ATP added, shelf-life profile of the replacement lots used | Solver output | INVENTORY (snapshot age checked) |
| **Expected recovery** | E[R] | P_liab × P_collect × min(cap, claimable_loss_o), where claimable_loss_o = PV − E[revenue_o] + excursion-caused costs. **Mitigation lowers the claimable amount but raises revenue.** For DEFAULT, P_liab is reduced by the GOV "failure-to-mitigate" factor | Finding (categorical) via a GOV lookup, `EXCESS_LIFE_SHARE`, counterparty history, REF.CONTRACTS caps |
| **Value** | NRV per sample; E[NRV], P10, P90 | NRV = revenue − C − penalties + E[R] | — |
| **Expected loss** | EL | PV_total − E[NRV] | — |
| **Value preserved** | ΔV | E[NRV_o] − E[NRV_default] | — |
| **Risk** | P(reject), P10 downside, food-safety flag, evidence risk | From the simulation; flags from E3 | — |
| **Confidence** | HIGH / MED / LOW + drivers | Thresholds (GOV) on: model validity (A3), coverage, data age, evidence conflicts, snapshot age, relative interval width (P90 − P10) ÷ \|E[NRV]\| | — |

**INSPECT (value of information):**
- In each simulated sample: draw the true SL; the inspection observes it with σ_insp after a delay at T_hold.
- Then choose the best of the options still feasible after that delay, given what was observed.
- Value = mean NRV − inspection cost.
- This captures "buy information vs lose the re-route window" exactly.

**Reproducibility:**
- The random seed is `hash(case_id, option_id, pack_revision, engine_version)`.
- The same inputs and versions always give the same numbers, and replay re-runs them.
- Each option stores `inputs_hash`, `engine_version`, `param_versions` and `seed`.

## E3 · Constraints that eliminate an option (each with an evidence ID)
| Code | Rule | Source | Effect |
|---|---|---|---|
| `FOOD_SAFETY` | Pulp above the hard limit for longer than the hard duration | GOV.HARD_LIMITS | Only INSPECT / HOLD / DISPOSE remain |
| `SPEC_INFEASIBLE` | P(accept) < the minimum acceptance probability (e.g. 0.8) | Simulation + GOV | Eliminated |
| `WINDOW_CLOSED` | Execution time (**+ approval buffer if decision rights require approval**) > the option's expiry (e.g. re-route junction passed) | Lanes, position, GOV.DECISION_RIGHTS | Eliminated |
| `CAPACITY` | The destination or carrier can't take it | REF / site data | Eliminated |
| `ORGANIC_INTEGRITY` | Conventional fruit can't fill an organic line | REF.PRODUCTS | Eliminated (that recovery plan) |
| `CONTRACT_PROHIBITS` | The customer contract forbids substitution or diversion | REF.CONTRACTS | Eliminated (or approval, if the clause allows consent) |
| `INVENTORY_STALE` | The replacement depends on a snapshot older than the limit | INVENTORY | Flagged LOW confidence; eliminated if older than the hard limit |
| `INSUFFICIENT_EVIDENCE` | Coverage below the minimum | Pack | Options other than INSPECT / HOLD are flagged LOW confidence (a soft rule) |

## E7–E8 · Ranking and routing
- **Objective** (policy-defined, versioned): `S(o) = E[NRV] − λ·(E[NRV] − P10[NRV]) − κ·tierA_shortfall_kg`.
  - λ is the risk aversion.
  - κ is the strategic weight on tier-A customers, beyond what contract penalties already capture.
  - Both come from `GOV.PARAMETERS`. **The LLM can't change them.**
- **Dominance:** Pareto dominance over (E[NRV], P10, P(reject), tier-A shortfall, confidence).
- **Rule decision** when the top option beats the next by more than the margin on S, and isn't worse on P(reject) or tier impact beyond tolerance, and no router trigger fires.
- **Otherwise** the case escalates, with reason codes (NEAR_TIE, HIGH_EXPOSURE, STRATEGIC_CUSTOMER, MODEL_OUT_OF_RANGE, QUALITATIVE_SIGNAL…).

## E9 · The Decision Brief: the six questions
Sealed as part of the case record (and hashed); approvals reference its hash.
```
brief {
  do_nothing:   {option_id, outcome}                         # Q1
  options:      [{option_id, label, outcome, flags}]         # Q2/Q3
  value_table:  [{option_id, E_NRV, P10, P90, ΔV_vs_default}]# Q4
  eliminated:   [{option_id, label, reasons[{code, detail, evidence_id}]}]  # Q5
  comparison:   {ranking_by_S, dominance, margin_top2, objective_version}
  recommendation:{option_id, decided_by: RULE|AGENT|HUMAN, why_structured[], narrative}  # Q6
}
outcome = {operational{P_accept, SL_arrival P10/P50/P90, ETA P50/P90, kg_delivered},
           financial{E_revenue, costs{…}, penalties, E_recovery, E_NRV, P10, P90, expected_loss, value_preserved},
           risk{P_reject, downside_P10, food_safety, evidence_risk},
           customer{lines, P_OTIF_by_line, tierA_shortfall_kg},
           logistics{added_h, added_mi, carrier_change, appointments},
           inventory{atp_consumed_by_site, atp_added},
           recovery_cost, confidence{level, drivers}}
```

**Worked example (illustrative numbers; the engine computes them).**
- **Lot A:** 4,200 kg organic, PV $47,040.
- **State:** SL_now ≈ 9.0 ± 0.8 days.
- **Customer:** the club customer needs ≥ 10 days at receipt; ETA 30 h.
- **Carrier:** holds 82% of the excess shelf-life loss.

| Option | P(accept) | E[NRV] | P10 | ΔV vs default | Notes |
|---|---|---|---|---|---|
| **Q1 Do nothing** (continue to club) | ≈ 0.00 | **$25.7k** | $22.9k | — | Rejected at receipt → processor salvage $13.8k; penalty $1.4k; contested claim (mitigation factor) E[R] $13.3k |
| **A · Re-route to regional DC** (6 h, 5-day spec, 95% price) + fill the club line from DC stock (14-day SL) | ≈ 1.00 | **$45.3k** | $45.0k | **+$19.6k** | Costs $1.6k; residual claim E[R] $2.2k; no tier-A shortfall |
| **B · Downgrade to processor** | 1.00 | $32.1k | $31.6k | +$6.5k | Larger claim, lower revenue |
| **C · Inspect at next node** | — | $31.8k | $30.9k | +$6.1k | The 4 h delay **closes the re-route window** (expires in 2 h 10 m) |
| *Expedite to club* | 0.01 | — | — | — | **Eliminated: SPEC_INFEASIBLE** (SL at arrival ≈ 8.3 < 10 days) |

- **Q6:** A beats B on S by $13.2k (41%), with no tier-A shortfall and no triggers. So it is **rule-decided** (`R-DISP-03@v4`), and the explanation is template-generated.
- **Governance:** the re-route value is above $25k, so policy requires **Sales manager approval**. The approval buffer was already included when checking that A's window is still open.

## Deterministic vs AI

| Concern | Deterministic engine | AI (escalated cases only) |
|---|---|---|
| State, transit, projection, acceptance | ✓ | — |
| Prices, costs, penalties, recovery, NRV, P10 / P90 | ✓ | — (never) |
| Which options exist and which are eliminated | ✓ | Can only request **bounded variants** via S1 (split, alternative destination *from the candidate list*, sensitivity). The engine computes them |
| Objective weights (λ, κ), thresholds, priors | ✓ (GOV, versioned) | — |
| Ranking, dominance, routing | ✓ | — |
| Explanation for rule decisions | ✓ (template) | — |
| Choice among non-dominated options | — | ✓ Recovery Strategist |
| Why, for an escalated choice | — | ✓, numbers restricted to Brief and S1 values |
| Causal judgment | Deterministic attribution, always computed alongside | ✓ Forensics |
| Claim argument | Amounts and prerequisites | ✓ Claims (text only) |

**How AI judgments touch numbers, and the controls on it:**
- The Forensics finding enters valuation **only as categorical inputs** (responsible party, sufficiency, confidence).
- These go through a **governed lookup table** (`GOV.PARAMETERS: p_liab_by_finding`) to produce P_liab.
- The deterministic, attribution-only P_liab is computed **alongside** and shown in the Brief, so any shift caused by AI judgment is visible and audited.
- A LOW-confidence finding falls back to the deterministic value.

## Guarantees that the LLM can't invent numbers
1. Numbers exist only as engine outputs, with provenance (inputs hash, versions, seed), stored in OPTIONS and the Brief.
2. An agent can obtain *new* numbers only through S1 / S2, and the engine computes them.
3. **Numeric matching in every `SUBMIT_*`:**
   - every number with a unit ($, %, kg, days, h, °C) in AI text must equal a value returned to that run, within the displayed rounding;
   - IDs and dates are exempt;
   - any unmatched number → REJECTED.
4. Rule decisions use templates only. No LLM is involved.
5. The Auditor checks that the statements built on those numbers are supported.
6. Approvals bind to the Brief hash. If the numbers change, the approval becomes stale.

## Placement and versioning
- **Python package `bbc_engine`** (written and unit-tested by Claude; imported into Snowflake procedures by CoCo). Modules: `state`, `transit`, `projection`, `acceptance`, `valuation`, `recovery`, `constraints`, `generator`, `solver`, `montecarlo`, `voi`, `rank`, `brief`, `explain`.
- **The same package serves** `CASE.GENERATE_AND_SCORE_OPTIONS`, tools S1 / S2 and `REPLAY_EVIDENCE`. One implementation.
- **Parameters:**
  - REF: prices, lanes, specs, contracts, product parameters, **new `REF.COST_RATES`** (inspection, transload, disposal, handling, expedite premium by site / lane, versioned);
  - GOV: λ, κ, the acceptance minimum, the fault-persistence prior, `p_liab_by_finding`, the failure-to-mitigate factor, Monte Carlo N, confidence thresholds.
- **Amendment:** +1 table `REF.COST_RATES`.

---

# Phase 12 — Autonomous Execution Framework

## Autonomy levels
| Level | Name | System may | Humans do |
|---|---|---|---|
| **L0** | Observe | Detect excursions, open cases, store evidence | Everything else |
| **L1** | Analyze | + assessment, options, Decision Brief (no recommendation) | Decide and initiate |
| **L2** | Recommend | + a recommendation (rule or agent, audited) | Choose and **initiate** execution through the gateway |
| **L3** | Execute low-risk | + **auto-execute** actions inside every L3 threshold, for reversible action types | Monitor; can reverse |
| **L4** | Execute material after approval | + prepare an execution plan for material actions and **run it automatically once the required approvals are recorded** | Approve or reject |

**Effective level for one action** = min(global ceiling, action-type maximum, decider cap, each dimension's level).

The inputs:
- **Global ceiling:** `GOV.PARAMETERS.autonomy_ceiling` (0–4).
- **Action-type maximum:** from `GOV.ACTION_TYPES`.
- **Decider cap:**
  - RULE = 4;
  - AGENT = 4, but only after an Auditor PASS, and any AI-chosen action above $10k is pushed into the approval band;
  - LOW-confidence = 2.
- **Dimension levels:** the thresholds below.

**Shadow** is a separate flag that works at any level. The full mutation record is written with status `SHADOW` and nothing is dispatched, so the system's actions can be compared with what humans actually did.

*This replaces the earlier OFF / SHADOW / ASSIST / AUTO mode:* OFF = L0, ASSIST = L2, AUTO = L4, SHADOW = the flag.

## Thresholds (`GOV.AUTONOMY_THRESHOLDS`, versioned; example defaults)
| Dimension | Measured by | L3 (auto) if all hold | L4 (approval) | Stricter |
|---|---|---|---|---|
| **Financial exposure** | Action value (revenue change + cost + claim / deduction / write-off amount) and the case's VALUE_AT_RISK | ≤ $10k **and** VaR ≤ $25k | ≤ $100k → one approver (Finance for money actions, Ops otherwise) | > $100k → **dual approval** (Finance + Ops) |
| **Customer impact** | Tier-A lines affected, minimum P(on-time-in-full) across affected lines, number of lines | No tier-A impact, P_OTIF ≥ 0.95, ≤ 2 lines | Any tier-A short or delay, or P_OTIF < 0.95 → Sales manager | > 10 lines, or > 20% of a customer's weekly volume → dual approval |
| **Inventory impact** | Replacement kg ÷ the site's quality-adjusted ATP for the product; stockout risk on other committed lines | ≤ 20%, zero stockout risk | Above that → Ops / Quality manager | — |
| **Operational risk** | P(reject), food-safety flag, reversibility class | P(reject) ≤ 5%, REVERSIBLE, no food-safety flag | P(reject) ≤ 20%, or COMPENSATABLE, or IRREVERSIBLE → Quality manager | Food-safety flag → only HOLD / INSPECT / DISPOSE, and DISPOSE needs Quality |
| **Confidence** | Option confidence; decider | HIGH and rule-decided | MEDIUM, or agent-decided with Auditor PASS | LOW → **L2** (a human must initiate) |
| **Data quality** | Data age, monitoring coverage, unresolved conflicts, inventory snapshot age | Age ≤ 30 min, coverage ≥ 80%, 0 unresolved conflicts, snapshot ≤ 6 h | Age ≤ 2 h, coverage ≥ 60%, conflicts adjudicated | Worse → **L2**. Age > 6 h → **L1** (nothing executes except the fallback) |

The approvers are the union of the roles named by every dimension that landed in L4. Dual approval needs two different people holding two different roles.

## Action-type registry (`GOV.ACTION_TYPES`)
| Action type | Target | Reversibility | Max level | Compensation | Preconditions (checked before the write) |
|---|---|---|---|---|---|
| STOCK_BLOCK (hold) | SAP MM | REVERSIBLE | 3 | STOCK_UNBLOCK | Stock unrestricted; quantity matches |
| REQUEST_EVIDENCE | Carrier / email | COMPENSATABLE (message) | 3 | WITHDRAW_REQUEST | — |
| CLAIM_NOTICE | Carrier API | COMPENSATABLE | 3 | WITHDRAW_NOTICE | Not already noticed |
| SO_CHANGE (lot / qty / date) | SAP SD | REVERSIBLE before goods issue | 4 (3 inside thresholds) | SO_REVERT | Order-line version unchanged; not shipped |
| REPLACEMENT_ALLOCATION | SAP SD / delivery | REVERSIBLE | 4 (3 inside thresholds) | DEALLOCATE | Replacement lot ATP ≥ qty (re-read) |
| REROUTE | TMS | COMPENSATABLE while the window is open | 4 (3 inside thresholds) | REROUTE_BACK | In transit; current destination = expected; junction not passed |
| REPROMISE_NOTICE | Customer (EDI 865) | COMPENSATABLE | 3, or 4 for tier-A | CORRECTION_NOTICE | Line version |
| PROCESSOR_SALE (downgrade) | SAP SD | COMPENSATABLE | 4 | CANCEL_SO | — |
| DISPOSE | WMS / SAP | **IRREVERSIBLE** | 4 (Quality) | none | Food-safety or no-value condition confirmed |
| FILE_CLAIM | Carrier API | COMPENSATABLE | 4 (Finance) | WITHDRAW_CLAIM | Evidence SUFFICIENT; before the deadline |
| GROWER_DEDUCTION | SAP FI | COMPENSATABLE (reversal posting) | 4 (Finance) | REVERSAL_POSTING | Settlement period open |
| ABSORB (write-off) | SAP FI | COMPENSATABLE | 3 up to $2.5k, else 4 | REVERSAL_POSTING | — |

**An IRREVERSIBLE action is never L3.** The fallback HOLD is REVERSIBLE and protective, so the deadline watchdog may run it whenever `fallback_enabled = true`, even below L3.

## The mutation gateway: the only code path that changes anything
- `CASE.EXECUTE_PLAN(rec_id)` builds an **execution plan** from the chosen bundle and calls **`CASE.MUTATE(intent)`** once per step.
- `MUTATE` is the *only* procedure that inserts into `CASE.MUTATIONS` (the outbox, formerly ACTIONS) or changes internal case state.
- Every other path goes through it: deadline fallback, human-initiated L2 execution, `REQUEST_EVIDENCE`, reversals.

**The nine required steps, all inside `MUTATE`:**
| # | Step | What happens | Recorded in the mutation record + ledger |
|---|---|---|---|
| 1 | **Validate** | Schema; the option is in the sealed Brief and **unexpired**; hard constraints re-checked against the latest data (food safety, data age); case state allows it; idempotency key not already applied; **expected before-state** computed from the latest OPS data | Validation result |
| 2 | **Authorize** | Effective autonomy level computed; decision rights evaluated; required approvals present, by distinct users with the role, proposer ≠ approver, **the approval's Brief hash = the current Brief hash**; global ceiling, `dispatch_enabled` and the shadow flag checked; **caller must be the engine principal** (never an agent role) | `policy_eval_id`, `autonomy_level`, `approval_ids`, `authorization_hash` |
| 3 | **Execute** | One transaction: write the record (PREPARED) + ledger + internal state change. External steps go to the outbox → dispatcher → target, with the idempotency key → ACK → VERIFIED | Status transitions with timestamps |
| 4 | **Before / after state** | `expected_before` (at authorization), `observed_before` (dispatcher reads the target just before the write), `expected_after`, `observed_after` (read back after the ACK) | All four JSON states |
| 5 | **Decision evidence** | Evidence pack ID + hash, Brief hash, option ID, recommendation ID | References + hashes |
| 6 | **Agent / decider** | Decider kind and ID: rule ID + version, or agent name + `run_id` + model + spec version, or human user. Also the executor principal (`CURRENT_USER`, `CURRENT_ROLE`) | Actor chain |
| 7 | **Timestamps** | `proposed_at, evaluated_at, approved_at, authorized_at, dispatched_at, acked_at, verified_at`. All set server-side by Snowflake; the target's reported time is kept separately | Timestamps |
| 8 | **Metric snapshot** | Frozen decision values from the Brief **+ a live re-read of the canonical metrics at execution time + the drift between them**. Drift beyond tolerance (e.g. shelf life −0.5 days, or data stale) → **re-authorization required** | Snapshot + drift |
| 9 | **Approval** | Approval IDs, approver users and roles, verdicts, freshness checks (or "not required: L3, reasons…") | Approval references |

**Mutation states:**
- `PROPOSED → VALIDATED → AUTHORIZED | PENDING_APPROVAL → AUTHORIZED / REJECTED / EXPIRED`
- `→ PREPARED → DISPATCHED → ACKED → VERIFIED`
- Exits: `ABORTED_PRECONDITION | FAILED → COMPENSATING → COMPENSATED`, or `SHADOW`.

## Idempotency
- **Mutation key** = `hash(case_id, dp, option_id, action_type, target_entity, brief_hash)`.
  - `MUTATE` holds the **gateway lock** (a single-row UPDATE on `CASE.GATEWAY_LOCK` that serializes mutations, like `LEDGER.HEAD`).
  - It then checks whether the key exists. **A duplicate returns the existing mutation; it never re-executes.**
- **Target conflicts:** under the same lock, the gateway rejects a new mutation on a `target_entity` that already has an in-flight mutation (PREPARED / DISPATCHED). The result is `CONFLICT`, and the case is re-planned. This stops two cases claiming the same replacement lot.
- **Dispatch:** at-least-once delivery + idempotency at the target = effectively once.
  - Before any retry, the dispatcher **asks the target for the key's status** (an idempotency header on our mocks; for real SAP, our reference stored in a document field). A timeout never causes a blind resend.
- **ACKs** are idempotent per `(mutation_id, attempt)`.
- **Compensations** carry their own key: `mutation_id + ':COMP'`.
- **Approvals:** one verdict per `approval_id`.

## Rollback (compensation, never deletion)
- **Plan ordering:**
  1. protective and reversible steps first (STOCK_BLOCK, CLAIM_NOTICE);
  2. then REROUTE;
  3. then SO_CHANGE / REPLACEMENT_ALLOCATION;
  4. then customer notices;
  5. **IRREVERSIBLE steps last**, and only after all earlier steps are VERIFIED.
  
  Financial filings belong to D2.
- **Plan atomicity** (in `CASE.EXECUTION_PLANS`):
  - `ALL_OR_NOTHING`: if a step fails, the completed steps are compensated in reverse order. Example: re-route + replacement, where you can't have one without the other.
  - `BEST_EFFORT`: keep completed steps, mark the plan PARTIAL and escalate. Example: notice + request.
- **Precondition drift:** `observed_before ≠ expected_before` on precondition fields → `ABORTED_PRECONDITION`. Nothing is written, and the case is set to `needs_reassessment`.
- **Post-ACK verification failure** (`observed_after ≠ expected_after`) → FAILED → compensation or escalation.
- **Human reversal after the fact:** `API.REVERSE_DECISION(rec_id, reason)`, available to roles authorized for that action type. It runs the compensations **through the same gateway** (validated, authorized, recorded). The original record stays, and the ledger shows both.
- **Kill switches** (changed through `ACTIVATE_POLICY`, ledgered):
  - `autonomy_ceiling`;
  - `shadow_mode`;
  - `fallback_enabled`;
  - `dispatch_enabled`.
  
  Plus a fast path, `API.EMERGENCY_STOP(reason)`, which sets `dispatch_enabled = false` immediately. Resuming requires a policy activation.

## No agent can bypass this
1. **One write path.**
   - `CASE.MUTATE` (owner's rights) is the only writer of mutations and case state.
   - Agent roles have **no USAGE** on it, or on `EXECUTE_PLAN`, `REVERSE_DECISION` or the dispatcher procedures.
   - The single agent mutation tool (`REQUEST_EVIDENCE`) calls the gateway internally, so it is validated and authorized like everything else.
2. **Dispatch reads only `API.V_DISPATCHABLE`.**
   - The view returns only AUTHORIZED rows whose `authorization_hash` is valid: recomputed from payload + `policy_eval_id` + approvals.
   - A row edited outside the gateway fails that check and never reaches a target system.
3. **Credentials.**
   - SAP, TMS and carrier credentials live only in the engine's dispatcher.
   - Agents have no network or integration tools.
4. **Grants.** No runtime role has DML on CASE or GOV tables. The owner role isn't used at runtime, and anything it does is visible to ledger verification.
5. **Invariant tests** (run continuously):
   - no external ACK without a PREPARED → AUTHORIZED → DISPATCHED ledger chain;
   - no mutation without a `policy_eval_id`;
   - no L4 mutation without fresh approvals;
   - no execution after expiry;
   - no agent principal as the executor;
   - no IRREVERSIBLE mutation at L3;
   - every COMPENSATED mutation has its compensation chain.

## Amendments to the Phase 8 inventory
| Change | Detail |
|---|---|
| +4 tables | `GOV.AUTONOMY_THRESHOLDS`, `GOV.ACTION_TYPES`, `CASE.EXECUTION_PLANS`, `CASE.GATEWAY_LOCK` |
| Rename / extend | `CASE.ACTIONS` → **`CASE.MUTATIONS`**, gaining the before/after, snapshot, drift, actor chain, `authorization_hash` and compensation link fields |
| Procedures | `COMMIT_EXECUTION` → `EXECUTE_PLAN` + **`MUTATE`**; `ACK_ACTION` → `ACK_MUTATION` (carries observed states); `NEXT_ACTIONS` reads `V_DISPATCHABLE`; new `API.REVERSE_DECISION` and `API.EMERGENCY_STOP` |
| Views | +1: `API.V_DISPATCHABLE` |
| GOV.PARAMETERS | `autonomy_mode` → `autonomy_ceiling`, `shadow_mode`, `fallback_enabled`, `dispatch_enabled` |

**Running table count:** 34 (Phase 8) + 1 (Phase 9) + 1 (Phase 10) + 1 (Phase 11) + 4 (Phase 12) = **41**.

---

# Phase 13 — Decision Memory

## Principles
- **Memory stores decisions, not conversations.** There is no chat memory anywhere. The unit of memory is a **sealed decision record**: what happened, what we knew, what we could have done, what we chose and why, who approved it, what we did, and what resulted.
- **Immutable and verified.**
  - Records are written once, when the case is sealed.
  - They're built only from ledger-verified data.
  - They're hashed, and the hash goes into the ledger.
- **Structured retrieval, not RAG.** Similarity uses typed features and hard filters. Text similarity is optional, secondary, and only for causation narratives.
- **Learning is governed.**
  - Memory produces calibration statistics and *proposals*.
  - Parameters change only through backtest → approval → policy / reference activation.
  - Nothing self-modifies.

## What each decision record stores (`MEMORY.DECISION_RECORDS`, one row per case × decision point, plus `MEMORY.DECISION_LOTS` per lot)
| Required item | Stored as | Source |
|---|---|---|
| **Event** | Trigger type, onset and detection timestamps, custody holder type at onset, lane, season (month), product / variety, organic flag | CASES, OPS |
| **State** | Per lot: kg, remaining shelf life ± σ, spec margin, holder exposure shares, coverage, data age, conflicts, ETA / position, replacement ATP available, affected lines (tiers, specs) | Evidence pack (frozen) |
| **Metrics** | Canonical metric snapshot `{name, value, unit, metric_version}` | Brief / pack |
| **Options** | Every option: kind, E[NRV], P10 / P90, P(accept), and eliminated options with reason codes | OPTIONS (frozen) |
| **Counterfactual results** | **Ex-ante:** predicted NRV of the default and the runner-up. **Ex-post:** the default and runner-up re-scored with the realized inputs (see below) | Brief + `bbc_engine` replay |
| **Recommendation** | Chosen option; decider kind (RULE / AGENT / HUMAN / FALLBACK); rule ID or agent | RECOMMENDATIONS |
| **Reason** | Structured `why` codes, escalation reasons, rejected-alternative reasons, rationale hash + reference | RECOMMENDATIONS |
| **Confidence** | Level + drivers; robustness flag | RECOMMENDATIONS, OPTIONS |
| **Approval** | Path: required roles, verdicts, latency, **override flag** (approver chose differently), dual-approval flag | APPROVALS |
| **Action** | Mutations: type, status, compensations, precondition aborts | MUTATIONS, EXECUTION_PLANS |
| **Outcome** | Receipt QC, actual shelf life at receipt, accepted?, shelf-life prediction error, acceptance prediction hit / miss | OUTCOMES |
| **Financial result** | Realized NRV, value protected (ex-ante and ex-post), costs, penalties, claimed, recovered, claim result + counterparty defense used | OUTCOMES, CLAIMS |
| **Evidence** | Evidence-pack ID + hash; documents used; finding (cause, responsible party, sufficiency, confidence) | EVIDENCE, FINDINGS |
| **Policy version** | `policy_version` and the autonomy level applied | POLICY_EVALUATIONS |
| **Semantic version** | Semantic-view version + metric-registry definition hashes | GOV.METRIC_REGISTRY |
| **Agent version** | Per agent run: agent, spec version, reference-card version, provider / model | AGENT_RUNS |
| **Also** | `engine_version`, parameter versions (product, contracts, prices, cost rates), provenance (`LIVE` / `SIMULATION_BACKFILL`) | — |
| **Timestamps** | Event, detection, decision, approval, execution, outcome, sealed | All |
| **Integrity** | `record_hash`, ledger sequence range, verification result at commit | LEDGER |
| **Retrieval keys** | Raw feature JSON + a **feature vector** (`VECTOR(FLOAT, n)`) with its `feature_version`. Optional `narrative_embedding` (Cortex embed) for incident text | Computed |

## Ex-post counterfactual (how "what if we'd done nothing?" gets *better* after the fact)
1. **Back-cast the true state.** The receipt QC gives the true shelf life on arrival for the path actually taken. Adding back the consumption between decision and receipt, from the observed temperatures, gives `SL_true_at_decision`.
2. **Re-score the default and runner-up** with `bbc_engine`, using `SL_true_at_decision`, the observed temperatures up to the intervention, and lane-calibrated transit times.
3. **Store `expost_default_nrv` and `expost_value_protected`** next to the ex-ante values.

The headline "value protected" therefore rests on what we learned, not only on what we predicted.

## Snowflake objects (new schema `MEMORY`)
| Object | Type | Purpose |
|---|---|---|
| `MEMORY.DECISION_RECORDS` | Table (insert-only) | Decision-level memory |
| `MEMORY.DECISION_LOTS` | Table (insert-only) | Lot-level state, outcome and feature vector (disposition precedents match at lot level) |
| `MEMORY.PARAM_PROPOSALS` | Table | Parameter changes suggested by calibration, waiting for backtest and review |
| `MEMORY.BACKTEST_RUNS` | Table | Results of replaying memory under proposed parameters or thresholds |
| `MEMORY.CAL_SHELF_LIFE` | DT | Prediction residuals by product × temperature band × coverage band: n, MAE, bias, quantiles. **Feeds σ in E1** |
| `MEMORY.CAL_ACCEPTANCE` | DT | Reliability bins: predicted P(accept) vs observed acceptance |
| `MEMORY.CAL_RECOVERY` | DT | Counterparty × basis × finding category: claim acceptance and recovery rate, typical defenses, response time. **Feeds P_liab / P_collect** |
| `MEMORY.CAL_TRANSIT_COST` | DT | Lane: observed transit quantiles vs REF.LANES; actual vs estimated costs vs REF.COST_RATES |
| `MEMORY.GOV_EFFECTIVENESS` | DT | Escalation reason × decider × outcome; action type × level × override rate × outcome. Measures **autonomy readiness** |
| `MEMORY.AGENT_EFFECTIVENESS` | DT | Each agent vs the rule-only baseline on realized NRV, plus Auditor fail rate. **Feeds the kill criteria** |
| `MEMORY.COMMIT_MEMORY(case_id)` | Procedure (Python) | Called by `SEAL_CASE`. Verifies the ledger range, assembles the record, computes the ex-post counterfactual and the features / vectors, hashes, inserts, writes ledger entry `MEMORY_COMMITTED` |
| `MEMORY.FIND_PRECEDENTS(case_id, lot_id, focus, k, as_of)` | Procedure | The retrieval algorithm below. Used by `AGENT.GET_PRECEDENTS`, the Brief and the router |
| `MEMORY.FEATURE_VECTOR(features, feature_version)` | UDF | Deterministic, versioned feature scaling → vector. *CoCo: verify whether it can return VECTOR directly, or return ARRAY and cast* |
| `MEMORY.PROPOSE_PARAMETERS()` + weekly task `MEMORY.T_PROPOSE` | Procedure + task | Calibration DTs → PARAM_PROPOSALS, each with an automatic backtest |
| `MEMORY.BACKTEST(proposal_id)` | Procedure (Python) | Replays sealed memory states through `bbc_engine` + the router under the proposal. Reports changes in decisions, automation rate, predicted NRV and override agreement |
| `API.REVIEW_PROPOSAL(proposal_id, verdict, reason)` | Procedure | Governance admin. Approval calls `ACTIVATE_POLICY` or `APPLY_REFERENCE_CHANGE` (ledgered) |
| `MEMORY.REBUILD_FEATURES(feature_version)` | Procedure | Recomputes vectors from the raw feature JSON when the feature definition changes |

## Retrieval: finding similar past decisions
1. **Hard filters** (must match):
   - the same decision point and focus (disposition / causation / claim);
   - the same product family + organic flag;
   - for causation and claims, the same responsible-holder type;
   - **`sealed_at < current pack.as_of`** (so replay is consistent);
   - integrity verified;
   - semantic version *compatible* (the metric registry marks breaking changes; incompatible records are excluded unless their features have been rebuilt).
2. **Structured similarity** (deterministic):
   - Compares the query's `FEATURE_VECTOR` to stored vectors with `VECTOR_L2_DISTANCE`. Weights are applied by scaling dimensions; the weights are versioned in GOV.
   - The features: remaining shelf life, spec margin, holder exposure-share profile, hours to ETA, value at risk (log), customer-tier mix, cause category, evidence coverage, season.
3. **Outcome-aware selection** among the top 3k candidates, returning k:
   - **both good and bad outcomes** (no survivorship);
   - at least one precedent whose chosen action *differs* from the current top option (a contrast case);
   - recency half-life weighting;
   - an older policy version is flagged, not hidden.
4. **Returned per precedent:**
   - event summary;
   - state at decision;
   - options considered with predicted values;
   - choice + decider;
   - approval / override;
   - outcome;
   - ex-ante vs ex-post value protected;
   - prediction errors;
   - claim result + the defense that worked or failed;
   - each with an `EV:PREC` evidence ID.
5. **Optional narrative channel** (Forensics only):
   - Uses `narrative_embedding` similarity over incident text (e.g. "driver reset reefer unit").
   - It runs **only after** the hard filters, returns memory IDs, and those resolve to the structured records above.
   - It is never free-text retrieval of documents.

## How precedents are used: PAST EVENT → PAST DECISION → PAST OUTCOME → CURRENT DECISION
- **Decision Brief:**
  - A deterministic "Precedents" section (the top 3) for approvers.
  - Example: *"3 similar cases: 2 re-routed (ex-post value protected avg $18.4k; SL error +0.3 d), 1 held → rejected at receipt (−$31k)."*
- **Router:** new trigger **`PRECEDENT_CONFLICT`**. If most of the good-outcome precedents chose a different action kind than the current top option, the case escalates instead of being rule-decided.
- **Agents** (through `GET_PRECEDENTS`):
  - Forensics compares causes;
  - the Strategist checks whether the precedents support or contradict its choice;
  - Claims learns which defenses this counterparty uses and which rebuttals worked.
- **Engine:**
  - σ, P(accept) calibration, P_liab / P_collect, transit quantiles and cost rates come from the **activated** parameter versions;
  - those versions were proposed from the calibration DTs and approved.

## How this improves the system over time (every loop is measurable and governed)
| Loop | Signal from memory | Improvement | Control |
|---|---|---|---|
| **Prediction calibration** | `CAL_SHELF_LIFE`, `CAL_ACCEPTANCE` | Tighter, honest σ; better P(accept). Fewer rejections from over-optimism and less value lost to over-caution | Proposal → backtest → approved REF / GOV change |
| **Recovery realism** | `CAL_RECOVERY` | P_liab / P_collect per counterparty and basis; a measured failure-to-mitigate factor; better claim strategy | Same |
| **Logistics and cost accuracy** | `CAL_TRANSIT_COST` | Lane p50 / p90 and cost rates match reality, so deadlines and windows are more accurate | Same |
| **LLM only when needed** | `GOV_EFFECTIVENESS` (e.g. NEAR_TIE escalations where the agent always picked the top score) | Adjust router margins, **so fewer LLM calls** where the agent adds nothing; keep escalation where it does | Router-rule proposal + backtest |
| **Autonomy expansion** | Override rate ≈ 0 and good outcomes for an action type at L4 | Evidence-based case for raising it to L3; also lowering an action type whose outcomes or overrides are bad | Threshold proposal + backtest + approval |
| **Agent quality** | `AGENT_EFFECTIVENESS`, overrides, Auditor fails | Overridden and poor-outcome cases become regression evals for `$agent-optimize`; kill criteria evaluated on real data | Eval gate before a new agent spec is activated |
| **Human approvers** | Precedents in the Brief | Faster, better-informed approvals; approval latency trend | — |

## Integrity, bias and honest limits
- **Immutability:**
  - insert-only tables;
  - `record_hash` in the ledger;
  - `COMMIT_MEMORY` refuses to commit if ledger verification fails for the case range.
- **No look-ahead:** retrieval and calibration used for a decision only include records sealed before that decision's `as_of`.
- **Version awareness:** every record carries policy, semantic, engine, agent and parameter versions, so a decision made under different rules is visible as such.
- **Selection bias, stated plainly:**
  - Only the chosen path's outcome is *observed*. Counterfactuals are model-based (improved ex-post by back-casting, but still estimates).
  - We do **not** run randomized exploration on perishable product.
  - Calibration therefore uses observed paths, and is reported with sample sizes.
- **Access:** agents reach memory only through `GET_PRECEDENTS` (case-scoped, read-only). Counterparty shares never include other parties' memory.
- **Demo seeding without hardcoding:**
  - A 30-day simulator backfill runs **the real pipeline**.
  - Scripted approvals are performed through the API by demo persona users and labelled `provenance = SIMULATION_BACKFILL`.
  - So memory, calibration and precedents exist before the live demo, all produced by the system itself.

## Amendments to the Phase 8 inventory
| Change | Detail |
|---|---|
| +1 schema | `MEMORY` (11 total) |
| +4 tables | 45 total |
| +6 Dynamic Tables | 20 total |
| +1 UDF | `FEATURE_VECTOR` |
| +1 task | `T_PROPOSE` |
| Procedures | +5 (`COMMIT_MEMORY`, `FIND_PRECEDENTS`, `PROPOSE_PARAMETERS`, `BACKTEST`, `REBUILD_FEATURES`) + `API.REVIEW_PROPOSAL` |
| Removed | View `CASE.V_DECISION_MEMORY`. `GET_PRECEDENTS` now calls `FIND_PRECEDENTS` |
| New router trigger | `PRECEDENT_CONFLICT` |
| New ledger entry type | `MEMORY_COMMITTED` |

---

# Phase 14 — Implementation Plan

## How the work runs
- **Tracks:**
  - **A** Claude / application;
  - **B** CoCo / Snowflake: you run it in Cortex Code from a brief I write *the day before*, then I validate with read-only `snow sql` and the tests;
  - **C** AI agents;
  - **D** Frontend;
  - **E** Testing;
  - **F** Demo.
- **No task depends on an open decision.**
  - **Day 1** settles every capability question that changes how something gets built.
  - **Day 2** freezes every contract (schemas, payloads, mock APIs).
  - The **frontend is specified on Day 12** and built only after you approve that spec.
- **Milestones:**

| Milestone | Day | Meaning |
|---|---|---|
| **M1** | 8 | Full lifecycle end-to-end, rule-decided |
| **M2** | 11 | Agent-escalated path end-to-end |
| **M3** | 12 | D2 claims |
| **M4** | 13 | Decision memory |
| **M5** | 16 | UI |
| **Demo** | 18 | — |

- **Optional features don't start until M1–M5 are green** (see "After core").
- **Branch:** work happens on `rebuild/v2`. I commit at the end of each day once you say so.

## Day 1 — Settle open decisions, scaffold
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 1.1 | A | Monorepo scaffold | `pnpm-workspace.yaml`, root `package.json`, `pyproject.toml` (uv workspace), `LICENSE` (Apache-2.0), `README.md`, `.gitignore`, `.env.example`, dirs `contracts/ snowflake/ packages/ apps/ python/ docs/adr/ docs/coco-briefs/ .cortex/skills/` | — | Empty workspace builds | `pnpm -r build`, `uv run pytest` succeed |
| 1.2 | A | CoCo brief WP1 | `docs/coco-briefs/WP1-foundation-spikes.md`: exact SQL + spike checklist + result template | — | Brief | Your review |
| 1.3 | B | Foundation | DB `BBC_OS` (30-day retention), 11 schemas, `BBC_TRANSFORM_WH` / `BBC_APP_WH`, 9 roles, users `BBC_ENGINE_SVC`, `BBC_AGENT_SVC`, persona + auditor users (PATs, default role / warehouse), `USE AI FUNCTIONS` grant | 1.2 | Objects exist | `snowflake/tests/00_foundation.sql` run by me |
| 1.4 | B | **Capability spikes**, results into ADR-0002: S1 ASOF in an incremental DT · S2 stream on a DT + triggered task · S3 directory-table stream + AI_EXTRACT on a PDF · S4 Snowpark Python runtime + numpy / scipy `milp` / jsonschema · S5 Python UDF returning VECTOR · S6 30-day retention · S7 Claude models available + a second model family for the Auditor · S8 Cortex Agent REST `:run` with a PAT + SSE, `DATA_AGENT_RUN` fallback, default-role behavior · S9 a generic tool with JSON-string args + all-required params · S10 single-row UPDATE lock serializing two sessions | Throwaway objects in `BBC_OS.SANDBOX` (dropped afterwards) | 1.3 | `docs/adr/0002-snowflake-capabilities.md` with evidence for each spike | I re-run the read-only checks; every spike is marked PASS or FALLBACK (and the fallback chosen) |
| 1.5 | A | ADRs that depend on the spikes | `0001-repo-tooling` (Python version from S4), `0003-auth` (PATs per service / persona; none in the browser), `0004-engine-and-drivers`, `0005-mock-contracts`, `0006-simulator` | 1.4 | ADRs | Your review |
| 1.6 | E | Test harness | `vitest.config.ts`, `pytest.ini`, `python/blueberrychain/cli/test_sql.py` (`bbc test sql`: a query returning 0 rows = pass) | 1.1 | Runner | Sample pass / fail tests behave correctly |
| 1.7 | F | Demo scenario catalog | `docs/demo/scenarios.md`: **S-A** rule-decided re-route; **S-B** ambiguous (certificate vs probe conflict, near-tie, tier-A); **S-C** claim with a carrier defense. Fault parameters; fictional names | — | Doc | Your review |
| 1.8 | — | **Your decision:** tear down the old `BLUEBERRY_CHAIN` DB, its agents and `BBC_APP_PG` (still billing) | — | — | Executed only if you confirm | — |

## Day 2 — Freeze the contracts
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 2.1 | A | Decision-contract JSON Schemas + generated types | `contracts/schemas/{evidence_pack, option, brief, finding, recommendation, claim_recommendation, audit_verdict, mutation_intent, mutation_record, tool_envelope}.json`, `contracts/schemas/tools/*.json`; `packages/shared` (TS types); `python/bbc_toolkit/schemas.py` | 1.5 | Schemas + types | Valid / invalid fixtures pass and fail in both pytest and vitest |
| 2.2 | A | Raw payload contracts + idempotency-key rules | `contracts/raw/{telemetry, sap_sales_order, sap_delivery, sap_stock, sap_inspection, tms_custody, tms_status, claim_response, document}.json` | 2.1 | Contracts | Fixture tests |
| 2.3 | A | Mock API contracts | `contracts/apis/mock-s4.odata.md` (entity sets, `$filter` on `LastChangeDateTime`, CSRF, material document 344, credit memo request, SO item change); `contracts/apis/mock-tms.openapi.yaml` (status, custody, reroute, claim, response) | 1.5 | Specs | OpenAPI lint |
| 2.4 | A | World + reference data | `python/blueberrychain/sim/world.yaml` (fictional); `bbc sim init` → reference CSVs (parties, sites, lanes, products + shelf-life params, specs, contracts, prices, cost rates, sensors) | 2.2 | CSVs | pytest referential-integrity checks |
| 2.5 | A | Ledger library (Python) | `python/bbc_toolkit/ledger.py` (canonical JSON, hash, verify) | 2.1 | Library | Unit tests |
| 2.6 | A | CoCo brief WP2 | `docs/coco-briefs/WP2-raw-ref-gov-ledger.md` | 2.1–2.5 | Brief | Review |
| 2.7 | B | RAW, REF, GOV, LEDGER | All RAW / REF / GOV tables; `LEDGER.ENTRIES`, `HEAD`; UDF `CANONICAL_HASH`; procs `LEDGER.APPEND`, `API.APPLY_REFERENCE_CHANGE`, `API.ACTIVATE_POLICY`; policy v1 (decision rights, router rules, hard limits, parameters, model registry, metric registry, autonomy thresholds, action types). Reference loaded via `bbc ref load` | 2.6 | Populated, versioned; ledger has REFERENCE_CHANGED and POLICY_ACTIVATED | `tests/02_ledger.sql` (chain + serialized concurrent append), `tests/02_ref_versions.sql` |
| 2.8 | E | Hash parity | Snowflake `CANONICAL_HASH` = Python `ledger.hash` on fixtures | 2.5, 2.7 | Parity | `bbc test sql` + pytest |

## Day 3 — Ingestion and physics state
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 3.1 | A | Connector SDK + Snowflake sink | `packages/connector-sdk` (Source / Sink / ActionHandler; batch MERGE on idempotency key; cursor committed in the same transaction; DLQ) | 2.2, 1.5 | Package | vitest unit + integration against a test schema; a re-sent batch creates no duplicates |
| 3.2 | A | Physics reference implementation | `python/bbc_engine/physics.py` (rate, consumed / excess life, projection) | 2.1 | Module | Unit tests vs hand-computed cases |
| 3.3 | A | IoT connector + simulator telemetry | `packages/connector-iot` (HMAC webhook); `python/blueberrychain/sim/{clock, physics_truth, telemetry}.py` | 3.1, 2.4 | Readings stream into `RAW.TELEMETRY` | 10 minutes of simulation → rows present; replaying the batch adds 0 rows |
| 3.4 | A | CoCo brief WP3 | `docs/coco-briefs/WP3-ops-dynamic-tables.md` | 2.2, S1 / S2 | Brief | Review |
| 3.5 | B | OPS layer | 9 typed DTs; UDFs `SHELF_LIFE_RATE`, `PROJECT_SHELF_LIFE_DAYS`; `TELEMETRY_ASSIGNED`, `LOT_THERMAL_BUCKETS`, `LOT_THERMAL_STATE`, `LOT_CUSTODY_EXPOSURE` (`$dynamic-tables`) | 2.7, 3.4 | DTs refreshing | `SHOW DYNAMIC TABLES` refresh modes as designed; `tests/03_ops.sql` (uniqueness, one primary probe, shares sum to 1) |
| 3.6 | E | Physics parity | DT consumed / excess life vs `bbc_engine.physics` on the same lot | 3.2, 3.5 | ≤ 0.1% difference | pytest + SQL |

## Day 4 — Business systems inbound + semantic view
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 4.1 | A | Mock S/4 + SAP inbound connector | `apps/mock-s4` (OData v2 subset), `packages/connector-sap-s4` (delta on orders, deliveries, stock, inspection lots) | 2.3, 3.1 | Business events in RAW → `OPS.ORDER_LINES` / `INVENTORY_SNAPSHOTS` | Contract tests vs the mock; DT rows present |
| 4.2 | A | Mock TMS + carrier inbound connector | `apps/mock-tms`, `packages/connector-carrier` (custody, status) | 2.3, 3.1 | `OPS.CUSTODY_EVENTS`; ASOF holder visible | Contract tests |
| 4.3 | A | Simulator drives every system | `sim/{orders, shipments, custody}.py`; `bbc sim run`, `bbc sim inject <fault>` | 4.1, 4.2 | Whole world flows through connectors only | `bbc sim run --hours 6` → `tests/04_world_consistency.sql` passes |
| 4.4 | A | CoCo brief WP5 | `docs/coco-briefs/WP5-semantic-view.md` | 3.5 | Brief | Review |
| 4.5 | B | Semantic view | `SEM.EXCURSION_RECOVERY`: live entities + the canonical metrics D1 needs; `GOV.METRIC_REGISTRY` hashes (`$semantic-view`) | 3.5, 4.4 | Semantic view | `tests/05_semantic.sql`: canonical values = DT values; inventory non-additive; registry hash matches |
| 4.6 | E | **Data checkpoint** | — | 4.3, 4.5 | Excursion visible in state within 2 minutes | Measured latency; checkpoint recorded |

## Day 5 — Decision math + case store
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 5.1 | A | Evaluation engine | `python/bbc_engine/{state, transit, projection, acceptance, valuation, recovery, constraints, generator, solver, montecarlo, voi, rank, brief, explain, autonomy}.py` | 2.1, 3.2, S4 | Package | **Golden test = the Phase 11 worked example** (ranking, eliminations, rule decision). Same seed → identical numbers. Property tests: no infeasible option survives; NRV formula parity |
| 5.2 | A | CoCo brief WP6a | `docs/coco-briefs/WP6a-case-store.md` | 2.1 | Brief | Review |
| 5.3 | B | Case store + detection | All CASE tables (incl. `MUTATIONS`, `EXECUTION_PLANS`, `TOOL_CALLS`, `GATEWAY_LOCK`), `EVIDENCE.EVIDENCE_PACKS`, `REF.COST_RATES` (loaded); `CASE.OPEN_CASES` + stream + triggered task (per S2) | 2.7, 3.5, 5.2 | A case opens after a fault is injected | Case `OPEN` within 2 minutes; the one-open-case-per-lot test passes |
| 5.4 | E | Engine tests in CI | `.github/workflows/ci.yml` (pytest, vitest, lint) | 5.1 | CI green | — |

## Day 6 — Understanding → Governance
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 6.1 | A | Shared validators + deploy tooling | `python/bbc_toolkit/validators.py`; `bbc deploy python` (zip → stage) | 2.1, 5.1 | Packages staged | Unit tests |
| 6.2 | A | CoCo brief WP6b | `docs/coco-briefs/WP6b-stage-procedures.md` | 6.1 | Brief | Review |
| 6.3 | B | Stage procedures | `BUILD_ASSESSMENT`, `GENERATE_AND_SCORE_OPTIONS`, `ROUTE`, `EVALUATE_POLICY` (autonomy level); view `CASE.V_DECISIONS`; `API.CLAIM_WORK`, `API.ADVANCE_CASE` | 5.3, 6.1, 6.2 | A case reaches PENDING_APPROVAL | `tests/06_stages.sql`: pack hashed; default + fallback present; S-A routes to RULE; L4 Sales approval; ADVANCE idempotent |
| 6.4 | A | Engine worker v0 | `packages/engine` (lease loop, ADVANCE_CASE, structured logs) | 6.3 | Worker drives cases | The S-A case advances unattended |
| 6.5 | E | Replay determinism | `BUILD_ASSESSMENT(as_of)` re-run | 6.3 | Identical pack hash | `tests/06_replay.sql` |

## Day 7 — Execution
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 7.1 | A | CoCo brief WP7a | `docs/coco-briefs/WP7a-gateway.md` | 6.3 | Brief | Review |
| 7.2 | B | Mutation gateway | `CASE.MUTATE`, `CASE.EXECUTE_PLAN`, `API.V_DISPATCHABLE`, `API.NEXT_ACTIONS`, `API.ACK_MUTATION`, `API.DECIDE_APPROVAL`, `CASE.ENFORCE_DEADLINES` + watchdog task, `API.EMERGENCY_STOP`; all grants | 6.3, 7.1 | Governed execution | `tests/07_gateway.sql`: no mutation without a policy evaluation; L4 blocked without approval; proposer ≠ approver; stale Brief hash rejected; duplicate key returns the existing mutation; CONFLICT on the same target; no IRREVERSIBLE at L3 |
| 7.3 | A | Dispatcher + adapters | `packages/engine/dispatch` (precondition read → call with key → read back → ACK); adapters: mock-s4 (stock block 344, SO change, allocation), mock-tms (reroute), customer notice (mock 865), carrier claim notice | 4.1, 4.2, 7.2 | Actions applied to the mocks | Integration tests: a timeout leads to a status query, never a double write |
| 7.4 | A | Persona approvals from the CLI | `bbc approve <id> --as sales_mgr` (persona PAT) | 7.2 | Approval recorded as that user | Approving with the wrong role is rejected |
| 7.5 | E | Failure injection | Mock mid-plan error → compensation; precondition drift → `ABORTED_PRECONDITION`; emergency stop halts dispatch | 7.3 | All behave as designed | Automated tests |

## Day 8 — Outcome + Audit → **M1: full lifecycle end-to-end (rule path)**
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 8.1 | A | Receipt QC from the simulator | `sim/qc.py` → mock-s4 inspection lots → inbound | 4.3 | `OPS.QC_INSPECTIONS` rows | DT check |
| 8.2 | A | CoCo brief WP7b | `docs/coco-briefs/WP7b-outcome-audit.md` | 7.2 | Brief | Review |
| 8.3 | B | Outcome and audit | `COMPUTE_OUTCOME`, `SEAL_CASE`, `API.VERIFY_LEDGER`, `API.REPLAY_EVIDENCE`, `API.EXPORT_EVIDENCE_PACK` (JSON), `API.GET_CASE_VIEW`, `API.V_CASE_INBOX`, `API.REVERSE_DECISION` | 8.2 | Cases seal | `tests/08_audit.sql`: VERIFY OK; **tamper on a zero-copy clone detected at the exact seq**; replay hash equal; export link works |
| 8.4 | A | CLI flows | `bbc case show / verify / replay / export`; `bbc demo run --scenario S-A`; `bbc demo reset` (re-simulates, nothing pinned) | 8.3 | Headless demo | — |
| 8.5 | E | **E2E-1** | `tests/e2e/test_s_a.py` | 8.4 | Every lifecycle state asserted + ledger verify + replay + invariants | **M1 gate:** 3 consecutive passes from `bbc demo reset` |
| 8.6 | F | CLI demo v0 | `docs/demo/script-v0.md` | 8.5 | Walkthrough | Timed dry run |

## Day 9 — Evidence pipeline + agent tools
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 9.1 | A | Documents from the simulator + files connector | `sim/documents.py` (certificates, BOL with setpoint, incident notes; deliberately inconsistent variants per fault); `packages/connector-files` (folder → PUT to stage) | 2.2, S3 | PDFs on `DOC_STAGE` | Files appear in the directory table |
| 9.2 | A | Toolkit + analysis modules | `bbc_toolkit/{capability, envelope, evidence_ids, audit, numeric_match}.py`; `bbc_engine/{signatures, model_validity}.py` | 6.1 | Library | Unit tests (injection text stays labelled; number matching) |
| 9.3 | A | CoCo briefs WP4 + WP8a | `docs/coco-briefs/WP4-evidence.md`, `WP8a-agent-tools.md` | 9.1, 9.2 | Briefs | Review |
| 9.4 | B | Evidence + agent tools | `DOCUMENTS`, `DOCUMENT_CLAIMS`, `EXTRACT_NEW_DOCUMENTS` + stream / task, `DOCUMENT_CONSISTENCY` DT; `API.START_AGENT_RUN` / `END_AGENT_RUN`; tools R1–R6, A1, A2 (empty until memory exists), A3, S1, C1, C2, M1, G1, G2 | 8.3, 9.3 | Tools callable by `BBC_AGENT_RUNTIME` only | `tests/09_tools.sql`: cross-case DENIED, expired run DENIED, unseen citation REJECTED, number mismatch REJECTED, budget enforced, one TOOL_CALLS row per call |
| 9.5 | C | Agent specs + compiler | `packages/agents/{forensics, strategist, auditor}.yaml`, `reference-cards/cold-chain.md`, compiler → `snowflake/agents/*.sql` | 9.4 signatures | Generated DDL | Compiler unit tests; DDL lint |

## Day 10 — Agents live
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 10.1 | B | Create the agents | 3 Cortex Agents from the generated DDL (`$cortex-agent`); `GRANT USAGE` to the agent role | 9.4, 9.5 | Agents respond | Each submits a *valid* artifact on an S-B case in Snowsight |
| 10.2 | A | Provider adapter + escalation step | `packages/engine/providers/cortex-agent.ts` (REST SSE; `DATA_AGENT_RUN` fallback per S8); worker escalation (start run → invoke → end run) | 10.1 | The worker runs escalations | Integration test on S-B |
| 10.3 | C | Eval set v1 | `python/blueberrychain/eval/` (≥ 30 simulator scenarios; oracle = injected cause + best option under ground truth) | 9.1, 5.1 | Eval set | — |
| 10.4 | E | Eval harness | `bbc eval` | 10.3 | Report | Gates: **policy violations = 0, citation validity 100%, numeric match 100%**, cause accuracy ≥ the deterministic baseline |

## Day 11 — Agent path end-to-end → **M2**
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 11.1 | B | Tune the agents | `$agent-optimize` on eval v1; record before / after | 10.3 | Improved scores | `bbc eval` report diff |
| 11.2 | A | Auditor independence + fail-closed | Model per `GOV.MODEL_REGISTRY` (S7); FAIL → author retry → human | 10.2 | Enforced | Tests: same-model audit DENIED; unavailable auditor blocks outbound |
| 11.3 | C | Kill-criteria baselines | `docs/agents/kill-criteria.md`: Strategist vs top-NRV; Forensics vs deterministic attribution | 11.1 | Measured | Numbers come from `bbc eval` |
| 11.4 | E | **E2E-2** | `tests/e2e/test_s_b.py`: escalation → finding → recommendation → audit → approval → execution → outcome → seal | 11.2 | **M2 gate:** 3 consecutive passes | — |
| 11.5 | F | S-B script | `docs/demo/script-v1.md` | 11.4 | — | Dry run |

## Day 12 — D2 settlement + claims → **M3**; frontend spec
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 12.1 | A | Claims side of the mocks | mock-tms claims API + rule-based counterparty responder (defenses: warm loading, setpoint not on the BOL, cap); mock-s4 FI deduction + reversal; dispatcher FILE_CLAIM / WITHDRAW / DEDUCTION | 7.3 | Mocks respond realistically | Contract tests |
| 12.2 | A | CoCo brief WP8b | `docs/coco-briefs/WP8b-claims.md` | 12.1 | Brief | Review |
| 12.3 | B | D2 path | Tools A4, S2, C3; D2 in `ROUTE` / `ADVANCE_CASE`; claims lifecycle through `MUTATE` / `ACK`; Claims agent | 12.2, M2 | Claims flow | `tests/12_claims.sql`: amount only from variants; FILE needs SUFFICIENT; deadline guard |
| 12.4 | C | Claims agent spec + evals | `packages/agents/claims.yaml`, `reference-cards/freight-claims.md`, defense eval set | 12.1 | Spec | `bbc eval --agent claims` |
| 12.5 | E | **E2E-3** | `tests/e2e/test_s_c.py`: notice → outcome → file → defense → rebuttal → settlement → seal | 12.3 | **M3 gate** | — |
| 12.6 | D | **Frontend spec** | `docs/frontend-spec.md`: information architecture; inbox; case workspace with the 11 lifecycle panels; evidence views; Brief / options; approvals; execution timeline; proof view; policy / version view; API endpoint ↔ procedure map; persona auth flow | Contracts final | Spec | **Your approval is required before Day 14** |

## Day 13 — Decision memory + backfill → **M4**
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 13.1 | A | Backcast, features, backfill | `bbc_engine/{backcast, features}.py`; `bbc sim backfill --days 30` (real pipeline; scripted persona approvals; `provenance = SIMULATION_BACKFILL`) | M3 | History generated by the system itself | Count of sealed cases; nothing hardcoded |
| 13.2 | A | CoCo brief WP10 | `docs/coco-briefs/WP10-memory.md` | 13.1 | Brief | Review |
| 13.3 | B | Memory | `MEMORY.DECISION_RECORDS`, `DECISION_LOTS`, `FEATURE_VECTOR` (per S5), `COMMIT_MEMORY` (wired into `SEAL_CASE`), `FIND_PRECEDENTS`; `GET_PRECEDENTS` rebound; router trigger `PRECEDENT_CONFLICT`; `CAL_SHELF_LIFE`, `CAL_ACCEPTANCE`, `CAL_RECOVERY` | 13.2 | Memory populated | `tests/13_memory.sql`: insert-only; hash in ledger; **no look-ahead**; balanced retrieval; replay returns the same precedents |
| 13.4 | F | Precedents visible | The Brief for a new S-A run shows precedents | 13.3 | **M4 gate** | Manual + test assertion |

## Day 14 — Frontend I (only after the spec is approved)
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 14.1 | D | App + server API layer | `apps/control-tower` (stack per spec), server route handlers → API procedures with persona PATs (none in the browser), persona switcher | 12.6 approved | App runs | Browser network inspection shows no Snowflake credentials |
| 14.2 | D | Inbox + workspace shell | Inbox sorted by deadline × VaR; lifecycle stage navigation | 14.1 | Screens | — |
| 14.3 | E | Playwright | `apps/control-tower/e2e/smoke.spec.ts` | 14.1 | Smoke test | CI |

## Day 15 — Frontend II
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 15.1 | D | Evidence panels | Temperature chart banded by custody; document-vs-sensor contradictions; causation finding | 14.2 | Panels | Visual check against the SQL values |
| 15.2 | D | Decision Brief panel | Do nothing vs options; eliminated options with reasons; rule-vs-AI badge; precedents | 14.2 | Panel | Values equal `GET_CASE_VIEW` |
| 15.3 | D | Approvals + live agent trace | Approve / choose another / reject + reason → `DECIDE_APPROVAL`; SSE trace from the engine | 14.2 | Panel | — |
| 15.4 | E | UI governance tests | Wrong role rejected; approval goes stale after an evidence change | 15.3 | Pass | Playwright |

## Day 16 — Frontend III → **M5**
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 16.1 | D | Execution timeline | Mutations with before / after, acks, compensations | 15.x | Panel | — |
| 16.2 | D | Proof panel | Verify, replay, tamper-on-clone, export; outcome + value protected (ex-ante / ex-post) | 15.x | Panel | — |
| 16.3 | D | Policy / versions + decision KPIs | Read-only policy; rule / agent mix, time to decision, value protected (from the semantic view) | 15.x | Panel | Values equal the semantic view |
| 16.4 | E | Full UI E2E | S-A, S-B, S-C through the UI | 16.1–16.3 | **M5 gate** | Playwright, 3 passes |

## Day 17 — Hardening
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 17.1 | A | Reset, cost and errors | `bbc demo reset` polish; warehouse auto-suspend; DT lag tuning; error states | M5 | Stable | Cost check in account usage |
| 17.2 | B | Invariant suite as a scheduled check | `tests/99_invariants.sql` (+ a task) | M5 | Always-on invariants | All 0-row results |
| 17.3 | E | Stability | All suites, 3 runs from reset | 17.1 | Green | — |
| 17.4 | A | Docs + project skills | README quickstart (`docker compose up` + `bbc deploy`), architecture, governance, CoCo runbook; `.cortex/skills/{bbc-deploy, bbc-verify-proof, bbc-replay, bbc-case-forensics}` | M5 | Docs | A fresh-clone walkthrough works |
| 17.5 | F | Dry run #1 | Timed, with feedback | 17.3 | Notes | — |

## Day 18 — Demo
| ID | Track | Objective | Files / objects | Depends on | Expected output | Validation |
|---|---|---|---|---|---|---|
| 18.1 | F | Final script | `docs/demo/script-final.md` (DATA → REASONING → DECISION → GOVERNANCE → ACTION → PROOF; judges choose the fault parameters) | 17.5 | Script | Dry run #2 |
| 18.2 | E | Freeze | Final E2E green; tag `v0.1.0` (with your OK) | 17.3 | Release | — |
| 18.3 | F | Recording + deck update | Video; slides use **numbers taken from the system** | 18.1 | Assets | Numbers cross-checked against SQL |

## After core (only once M1–M5 are green, in priority order)
1. Learning loop: `PROPOSE_PARAMETERS`, `BACKTEST`, `API.REVIEW_PROPOSAL`, `CAL_TRANSIT_COST`, `GOV_EFFECTIVENESS`, `AGENT_EFFECTIVENESS`.
2. External LLM adapter (anthropic / openai-compatible). Pluggability is already shown inside Cortex through the Auditor's separate model.
3. Packaging: Snowflake Native App, npm / PyPI packages. **I'll confirm with you before any publish.**
4. Connectors: MQTT, EDI 856.
5. Counterparty evidence sharing (Secure Data Sharing / reader account).
6. Narrative embeddings for Forensics.
7. PDF version of the evidence pack.

## If the schedule slips
- **Protect:** M1, M2, a minimal M5, and the S-A + S-B demos.
- **Cut, in this order:**
  1. S-C depth (keep CLAIM_NOTICE only);
  2. backfill size;
  3. the policy / version panel;
  4. reversal in the UI (keep the CLI).
