# WP1: Foundation and capability spikes

**Plan tasks:** 1.3 (foundation) and 1.4 (spikes). **Depends on:** nothing. **Unblocks:** every later Snowflake work package.

**Why the spikes come first.** Ten questions about this trial account decide *how* later objects get built. For example, whether an ASOF JOIN can run inside an incremental Dynamic Table, or whether a Cortex Agent can be called over REST with a token. Each spike either confirms the design or switches it to a documented fallback before anything depends on it.

## Before you start
- Open the repo in **Cortex Code** and switch to **Plan Mode**.
- The session uses connection `pndvhar-pt70809` (role ACCOUNTADMIN). The old `BLUEBERRY_CHAIN` database and its objects are **not touched**.
- **Cost:** everything runs on X-Small warehouses with 60-second auto-suspend. A resource monitor (`BBC_MONITOR`, 50 credits / month, notify at 75%, suspend at 100%) is attached to both new warehouses. Change `CREDIT_QUOTA` in `00_account.sql` first if you want a different cap.

## Step 0: Pre-flight (catches the wrong account before anything runs)
Ask CoCo to **execute** this and show the result:
```sql
SELECT CURRENT_ORGANIZATION_NAME() AS org, CURRENT_ACCOUNT_NAME() AS account,
       CURRENT_USER() AS usr, CURRENT_ROLE() AS role;
```
**Expected:** org `PNDVHAR`, account `PT70809`, user `DURGAPRASAD17`, role `ACCOUNTADMIN`. If any value differs, stop and switch CoCo's connection to `pndvhar-pt70809`.

**Plan Mode only *proposes* statements.** After reviewing each plan, approve its **execution**. A WP1 run that stops at the plan leaves the account unchanged.

## Step 1: Foundation (`snowflake/modules/00_account.sql`)
Prompt for CoCo:
> Run `snowflake/modules/00_account.sql` against connection pndvhar-pt70809, section by section, in Plan Mode. Validate each statement first. If a statement fails because of a syntax or privilege detail on this account, propose the smallest fix, apply it to the file in the repo, then run it. Don't skip any statement. At the end, list every change you made to the file.

The script creates:

| Object | Detail |
|---|---|
| Roles (9) | `BBC_OWNER`, `BBC_INGEST`, `BBC_ENGINE`, `BBC_AGENT_RUNTIME`, `BBC_QUALITY_MGR`, `BBC_SALES_MGR`, `BBC_FINANCE_MGR`, `BBC_AUDITOR`, `BBC_GOVERNANCE_ADMIN` |
| Warehouses (2) + resource monitor | `BBC_TRANSFORM_WH`, `BBC_APP_WH`, `BBC_MONITOR` |
| Database | `BBC_OS` (30-day retention), owned by `BBC_OWNER` |
| Schemas (11, managed access) | RAW, REF, GOV, OPS, EVIDENCE, **DECISION**, LEDGER, SEM, AGENT, API, MEMORY. PUBLIC is dropped |
| Authentication policy | `BBC_OS.GOV.BBC_PAT_ONLY`: PATs only; no network policy required on this trial |
| Users (8) | 3 service users (`BBC_INGEST_SVC`, `BBC_ENGINE_SVC`, `BBC_AGENT_SVC`) + 5 demo persona users (`BBC_DEMO_*`). Each defaults to its single runtime role and `BBC_APP_WH` |

**Statements most likely to need a CoCo fix**, which is expected:
- `GRANT USE AI FUNCTIONS ON ACCOUNT`: the prior build needed it. If this account rejects it, keep only the `CORTEX_USER` grants.
- `CREATE AUTHENTICATION POLICY … PAT_POLICY = (…)`: the exact option names.
- `DATA_RETENTION_TIME_IN_DAYS = 30`: if the edition refuses it, use 1. That is spike S6's fallback.

**Post-flight for step 1.** Ask CoCo to execute:
```sql
SHOW DATABASES LIKE 'BBC_OS';
SHOW ROLES LIKE 'BBC_%';
SHOW USERS LIKE 'BBC_%';
```
**Expected:** 1 database; 9 new roles (the 5 old `BBC_*_ROLE` roles also appear, which is fine); 8 users.

## Step 2: Tokens (`snowflake/modules/00b_tokens.sql`), *not* in CoCo
1. Run it in a **Snowsight worksheet**, or with `snow sql -c pndvhar-pt70809 -f snowflake/modules/00b_tokens.sql`. Each statement shows a token secret **once**.
2. Copy `.env.example` to `.env`, then paste each secret into the variable named in that statement's comment (`BBC_AGENT_PAT`, `BBC_ENGINE_PAT`, …).
3. **Don't paste secrets into any chat, CoCo included.** Transcripts are stored on disk.

If PAT creation for `TYPE = SERVICE` users is refused, for example because a network policy is required, tell Claude the exact error. The fallback is a network policy that allows only your current IP.

## Step 3: Spikes (`snowflake/spikes/wp1_spikes.sql`)
Prompt for CoCo:
> Run `snowflake/spikes/wp1_spikes.sql` section by section (S1–S9 and the S10 setup) as BBC_OWNER, in Plan Mode. For each section, show me the result rows, then tell me whether it meets the PASS condition in its header comment. Where a section offers a fallback (S1b, scheduled task, Python 3.11, ARRAY return), try the fallback only if the primary fails. For S3, first upload `docs/coco-briefs/assets/sample_inspection_cert.pdf` to `@BBC_OS.SANDBOX.DOCS` with AUTO_COMPRESS = FALSE. Don't run the cleanup section yet.

Record each result in [ADR-0002](../adr/0002-snowflake-capabilities.md): **PASS**, or **FALLBACK** plus which fallback, together with the key evidence (refresh mode, versions, model list, extracted values).

| Spike | Question | PASS when | Fallback |
|---|---|---|---|
| S1 | ASOF JOIN in an incremental Dynamic Table | `refresh_mode = INCREMENTAL` and the lots are L-1 then L-2 | S1b interval join |
| S2 | Stream on a DT + triggered task | `T_TASK_LOG` gets a row within about 2 minutes | `SCHEDULE = '1 MINUTE'` |
| S3 | Directory stream + AI_EXTRACT on a PDF | Stream shows the file. Extraction returns `SFI-2026-044812`, `L-2291`, `1.0`, `0.5`, `0.5` | Text-layer extraction via `AI_PARSE_DOCUMENT`, then `AI_EXTRACT(text => …)` |
| S4 | Python runtime + numpy / scipy `milp` / jsonschema | Versions returned, `milp_x = [0, 1]` | Runtime 3.11; greedy solver if `milp` is missing |
| S5 | Python UDF returning VECTOR | Distance = 1 | `RETURNS ARRAY` + cast |
| S6 | 30-day Time Travel | Value = 30 | 1 day (replay doesn't depend on it) |
| S7 | Which Cortex models answer | ≥ 1 Claude model + a second model family | Agents and Auditor on the two best available |
| S8 / S9 | Agent REST with a PAT; JSON-string args; tool runs as `BBC_AGENT_SVC`; ungranted tool refused | **Claude runs** `snowflake/spikes/s8_agent_rest.py` | `DATA_AGENT_RUN` (the SQL call in S8) |
| S10 | Single-row UPDATE lock serializes two writers | **Claude runs** `snowflake/spikes/s10_lock.py`: n = 1 and 2, ~8 s apart | Single-writer append: writers insert into a staging table, and one task (task runs never overlap) assigns `seq` and chains the hashes |

**One thing to note at S8:** if `claude-sonnet-4-6` didn't answer in S7, edit the `models.orchestration` line of `SPIKE_AGENT` to the best Claude model that did, before creating the agent.

## Step 4: Tell Claude
Say "WP1 done". Claude then:
1. runs `uv run bbc test sql snowflake/tests/00_foundation.sql`, where every test must PASS;
2. runs S8 / S9 (`uv run python snowflake/spikes/s8_agent_rest.py`) and S10 (`uv run python snowflake/spikes/s10_lock.py`);
3. completes ADR-0002 and finalizes the ADRs that depend on the spikes (0001 Python runtime, 0004 drivers);
4. asks you to run the cleanup section, which drops the `BBC_OS.SANDBOX` schema and `SPIKE_AGENT`.

## Result log (fill in)
| Item | Result | Notes / changes CoCo made |
|---|---|---|
| 00_account.sql | PASS (2026-10-06) | Ran unchanged; `00_foundation.sql` 8/8 PASS |
| 00b_tokens.sql | PASS | 8 role-restricted PATs written straight into `.env` by a local script (secrets never printed) |
| S1 | FALLBACK | ASOF JOIN rejected in an incremental DT; S1b interval join is INCREMENTAL |
| S2 | PASS | Triggered task fired 30 s after the insert |
| S3 | PASS | AI_EXTRACT returned every expected value |
| S4 | PASS | Python 3.12.13, scipy 1.18.1, jsonschema 4.26.0, milp [0, 1] |
| S5 | PASS | Distance = 1 |
| S6 | PASS | 30 days |
| S7 | PASS | Claude 4.x + openai-gpt-5; llama4-maverick unavailable, so the Auditor uses openai-gpt-5 |
| S8 / S9 / S10 | PASS | See ADR-0002; SANDBOX and SPIKE_AGENT dropped afterwards |
