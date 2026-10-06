# WP2: RAW, REF, GOV and the ledger

**Plan tasks:** 2.7 (tables, ledger, governed procedures, reference data, policy v1) and 2.8 (hash parity). **Depends on:** WP1 done *and validated by Claude* (`snowflake/tests/00_foundation.sql` green, spike S4 and S7 results in ADR-0002). **Unblocks:** WP3 (OPS Dynamic Tables).

**What this builds.** The landing tables, the versioned reference data, the versioned policy, and the hash-chained ledger that records every change to the last two. Once WP2 is done, every later write in the system has a governed path and an audit entry.

| Module | Objects |
|---|---|
| `05_code_stage.sql` | Stage `BBC_OS.GOV.CODE` for the Python packages procedures import |
| `10_raw.sql` | `RAW.TELEMETRY`, `RAW.BUSINESS_EVENTS`, `RAW.CONNECTOR_STATE`, `RAW.INGEST_ERRORS` |
| `20_ref.sql` | 9 versioned tables: `REF.PARTIES`, `SITES`, `LANES`, `PRODUCTS`, `CUSTOMER_SPECS`, `CONTRACTS`, `CHANNEL_PRICES`, `SENSORS`, `COST_RATES` |
| `30_gov.sql` | 9 policy tables (`GOV.POLICY_VERSIONS`, `PARAMETERS`, `DECISION_RIGHTS`, `ROUTER_RULES`, `HARD_LIMITS`, `AUTONOMY_THRESHOLDS`, `ACTION_TYPES`, `MODEL_REGISTRY`, `METRIC_REGISTRY`) and the function `GOV.ACTIVE_POLICY_VERSION()` |
| `40_ledger.sql` | `LEDGER.ENTRIES`, `LEDGER.HEAD` (one row: seq 0, 64 zeros) |
| `50_governed_procs.sql` | UDF `LEDGER.CANONICAL_HASH`; procedures `LEDGER.APPEND`, `API.APPLY_REFERENCE_CHANGE`, `API.DRAFT_POLICY`, `API.ACTIVATE_POLICY`; their grants |

**Who runs what.** Steps 1, 3 and 4 run in **Cortex Code**. Steps 2, 5, 6 and 7 run in a **terminal** at the repo root, because they upload files, call procedures as different users, and read `.env`.

## Before you start
- Open the repo in **Cortex Code** and switch to **Plan Mode**. Approve **execution** of each plan, not just the plan.
- Statements run as **`BBC_OWNER`** (each module starts with `USE ROLE BBC_OWNER`).
- **Cost:** a few minutes of an X-Small warehouse.
- **Claude does one thing first:** update `model_registry` in `snowflake/seed/policy/v1.json` from the S7 result, so `uv run bbc policy check` prints OK. Until that's done, stop after step 5.

## Step 0: Pre-flight
Ask CoCo to **execute**:
```sql
SELECT CURRENT_ORGANIZATION_NAME() AS org, CURRENT_ACCOUNT_NAME() AS account, CURRENT_USER() AS usr;
SHOW SCHEMAS IN DATABASE BBC_OS;
```
**Expected:** `PNDVHAR` / `PT70809` / `DURGAPRASAD17`, and 11 schemas (RAW, REF, GOV, OPS, EVIDENCE, DECISION, LEDGER, SEM, AGENT, API, MEMORY) plus `INFORMATION_SCHEMA`. If `BBC_OS` doesn't exist, WP1 hasn't run: stop.

## Step 1: Code stage (CoCo)
> Run `snowflake/modules/05_code_stage.sql` against connection pndvhar-pt70809 in Plan Mode. If a statement fails on a syntax or privilege detail, propose the smallest fix, apply it to the file in the repo, then run it.

## Step 2: Upload the Python packages (terminal)
```bash
uv run bbc deploy python
```
**Expected:**
```
uploaded bbc_toolkit-0.1.0.zip -> @BBC_OS.GOV.CODE/bbc_toolkit/0.1.0/
uploaded bbc_engine-0.1.0.zip -> @BBC_OS.GOV.CODE/bbc_engine/0.1.0/
```
The zips are byte-for-byte reproducible, so re-running is safe.

## Step 3: Tables (CoCo)
> Run `snowflake/modules/10_raw.sql`, `20_ref.sql`, `30_gov.sql` and `40_ledger.sql`, in that order, in Plan Mode. Same rule: any fix goes back into the file in the repo. At the end, list every change you made.

**Post-flight.** Ask CoCo to execute:
```sql
SELECT table_schema, COUNT(*) AS tables
FROM BBC_OS.INFORMATION_SCHEMA.TABLES
WHERE table_schema IN ('RAW', 'REF', 'GOV', 'LEDGER') AND table_type = 'BASE TABLE'
GROUP BY 1 ORDER BY 1;
SELECT * FROM BBC_OS.LEDGER.HEAD;
```
**Expected:** GOV 9, LEDGER 2, RAW 4, REF 9. HEAD is one row: `1, 0, 0000…0000` (64 zeros).

## Step 4: Governed procedures (CoCo)
**Apply the S4 result first.** All five objects in `50_governed_procs.sql` use `RUNTIME_VERSION = '3.12'`. If S4 found 3.12 unavailable, change all five to `'3.11'` in the file. If S4 found **no** `jsonschema` package, stop and tell Claude.

> Run `snowflake/modules/50_governed_procs.sql` in Plan Mode. Any fix goes back into the file in the repo.

**Smoke test.** Ask CoCo to execute:
```sql
SELECT BBC_OS.LEDGER.CANONICAL_HASH(PARSE_JSON('{"b":1,"a":[true,null],"c":1.50}')) AS h;
SHOW PROCEDURES IN SCHEMA BBC_OS.API;
```
**Expected:** `h = 2a01d03bf94d761ca84f401b8a0edae3b5e332581e71ceb30e897408765b3356`, which is the Python toolkit's hash of the same object (`1.50` hashes as `1.5`). There should be three API procedures: `APPLY_REFERENCE_CHANGE`, `DRAFT_POLICY`, `ACTIVATE_POLICY`.

## Step 5: Reference data (terminal)
```bash
uv run bbc sim init
uv run bbc ref load --reason "WP2 initial reference load"
```
**Expected:** one `OK` line per entity in dependency order: PARTY, SITE, LANE, PRODUCT, CUSTOMER_SPEC, CONTRACT, CHANNEL_PRICE, SENSOR, COST_RATE. Each line shows its inserted count and a ledger number (`ledger #1` to `#9` on a fresh ledger).

**Then run the load again.** Every line must show `inserted 0` and `no change`, and no new ledger entries may appear. This shows that loading is idempotent and that a no-op isn't recorded as a change.

## Step 6: Policy v1, with separation of duties (terminal)
`.env` must contain `SNOWFLAKE_ACCOUNT` and `BBC_GOVADMIN_PAT` (from WP1 step 2).
```bash
uv run bbc policy check
uv run bbc policy draft
uv run bbc policy activate 1 --reason "WP2 go-live" --as builder
uv run bbc policy activate 1 --reason "WP2 go-live" --as govadmin
```
**Expected:**
1. `check` prints OK.
2. `draft` returns `"status": "OK"`, `"policy_version": "1"`, recorded as `DURGAPRASAD17`.
3. The first `activate`, as the builder, returns **`"status": "DENIED"`**: the user who drafted a policy can't activate it. This is the intended result.
4. The second `activate`, as `BBC_DEMO_GOVADMIN` over the SQL API with its role-restricted token, returns `"status": "OK"`.

## Step 7: Tests (terminal)
```bash
uv run bbc test sql
```
**Expected:** every test in `00_foundation.sql`, `02_ledger.sql`, `02_hash_parity.sql`, `02_reference.sql` and `02_policy.sql` is PASS. The checks cover:
- the chain re-hashes and links with no sequence gaps;
- the head matches the last entry;
- only the owner can write the ledger;
- Snowflake's hash reproduces every cross-language vector;
- one current version per key, and every reference batch is in the ledger;
- one active policy, activated by someone other than its drafter, matching its hash and its ledger entry.

## Step 8: Tell Claude
Say **"WP2 done"**, and paste:
- CoCo's list of changes to the `.sql` files;
- the output of steps 5 and 6.

Claude re-runs step 7 read-only and marks WP2 done.

## If something goes wrong
| Symptom | Likely cause | What to do |
|---|---|---|
| `PUT` fails in step 2 with insufficient privileges | The connection's role doesn't roll up to `BBC_OWNER` | `00_account.sql` grants `BBC_OWNER` to `SYSADMIN` and to your user; check `SHOW GRANTS OF ROLE BBC_OWNER` |
| Step 4: `Package 'jsonschema' not found` or a version conflict | Package channel differs from S4 | Paste the error to Claude. The toolkit supports older `jsonschema` through its legacy resolver, so it may only need the version pin removed |
| Step 4: `Cannot find module bbc_toolkit` | Step 2 didn't run, or the stage path differs | `LIST @BBC_OS.GOV.CODE` should show `bbc_toolkit/0.1.0/bbc_toolkit-0.1.0.zip` |
| Step 5 or 6 returns `INVALID` with a list of errors | The batch or policy fails its contract inside Snowflake | Paste the errors to Claude; nothing was written |
| Step 6: the govadmin call fails with HTTP 401 / 390xxx | The PAT is missing, expired, or blocked by a network rule | Check `.env`; see WP1 step 2 for the network-policy fallback |
| Step 6: the govadmin call returns `DENIED` | `CURRENT_USER()` inside the owner's-rights procedure isn't the caller (spike S9) | Stop and tell Claude: separation of duties depends on it |

## Result log (fill in)
| Item | Result | Notes / changes CoCo made |
|---|---|---|
| 05_code_stage.sql | PASS (2026-10-06) | — |
| bbc deploy python | PASS | — |
| 10 / 20 / 30 / 40 | PASS | Unchanged; GOV 9, LEDGER 2, RAW 4, REF 9; HEAD genesis row |
| 50_governed_procs.sql (runtime used) | PASS, 3.12 | Fixed: `COMMENT` must precede `EXECUTE AS` (same fix in 55 and 81) |
| CANONICAL_HASH smoke | PASS | `2a01d03b…3356` |
| bbc ref load (first / second run) | PASS | First run exposed two bugs, both fixed: VARIANT args now `PARSE_JSON(?)` in the CALL; `bind_nulls` stops Snowpark binding `None` as `'None'`. The 9 bad bootstrap rows were reset; then 9 batches = ledger #1-#9; second run all `no change` |
| policy draft / activate as builder / as govadmin | PASS | Auditor model set to openai-gpt-5 (S7). Draft = ledger #10; builder activation DENIED; govadmin OK = ledger #11 |
| bbc test sql | PASS | 23/23 (00, 02_*) |
