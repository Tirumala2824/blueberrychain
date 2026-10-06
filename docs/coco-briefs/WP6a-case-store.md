# WP6a: The decision store and detection

**Plan tasks:** 5.3 (case store + detection: a case opens after a fault is injected, within 2 minutes; one open case per lot). **Depends on:**
- WP5 done and validated (all `05_semantic` tests green);
- spike S2 (stream on a Dynamic Table + triggered task) and S4 (Python runtime) recorded in ADR-0002.

**Unblocks:** Day 6 (stage procedures: assessment, options, routing, policy evaluation).

**What this builds.**
- **The decision store:** every lifecycle record from case to outcome, plus the outbox, agent runs and tool calls. The tables stay empty until WP6b and WP7 write them.
- **Sealed evidence packs.**
- **Detection:** when thermal buckets change, a triggered task calls `DECISION.OPEN_CASES`. It opens a Recovery Case, adds a lot to an open one, or extends one, and writes each opening and each added lot to the ledger in the same transaction.

| Module | Objects |
|---|---|
| `80_decision_store.sql` | 16 tables in `DECISION` (see the list below) and `EVIDENCE.EVIDENCE_PACKS`; auditors get SELECT, nobody else gets anything |
| `81_detection.sql` | Stream `DECISION.S_THERMAL_BUCKETS` on `OPS.LOT_THERMAL_BUCKETS`; procedure `DECISION.OPEN_CASES()` (handler `bbc_toolkit.snow.proc_open_cases`); task `DECISION.T_DETECT` |

The 16 `DECISION` tables:
- the case: `CASES`, `CASE_LOTS`;
- lifecycle records: `CAUSATION_FINDINGS`, `OPTIONS`, `RECOMMENDATIONS`, `POLICY_EVALUATIONS`, `APPROVALS`, `EXECUTION_PLANS`, `MUTATIONS`, `CLAIMS`, `OUTCOMES`;
- agents and tools: `AGENT_RUNS`, `TOOL_CALLS`;
- coordination: `GATEWAY_LOCK`, `ID_COUNTERS`, `DETECTION_LOG`.

**The detection rule** (versioned inputs only: the policy's `detection_window_min`, each product's `threshold_c` and `tolerance_min`):
- **When a case opens.** A lot is in excursion when its *counted* breach minutes in the trailing window exceed the product's tolerance.
- **Which readings count.** A reading counts when it lies outside the grower's contractual pre-cool window, and either the lot has already been cold or someone other than its grower holds it.
- **Onset** is the start of the current breach run.
- **One open case per episode.** An episode is the shipment the lot is on, or the lot at its site when it's off a shipment.

**Already proven before this brief.**
- **Handler logic.** `python/bbc_toolkit/tests/test_open_cases.py` checks: open, join, extend, sealed cases not reused, rollback, no policy, contiguous ids.
- **Detection SQL vs Python.** `snowflake/spikes/wp6a_detection_dryrun.py` ran the procedure's detection SQL unchanged in this account, read-only, over simulated trips cut off every 5 minutes. It matched the Python reference at every cut-off:
  - **S-A:** the rule first holds at +1.83 h, onset 11:25 in Sierra's custody.
  - **S-B:** the rule first holds at +0.65 h, onset 10:05 once Coastline holds the warm lot.
  - The dry run also caught a CTE name clash, now fixed.

What's left to confirm in the account: the objects create, the triggered task fires, and a case opens within 2 minutes.

**Who runs what.** Steps 3 and 4 run in **Cortex Code**. Steps 0, 1, 2, 5 and 6 run in a **terminal** at the repo root.

## Before you start
- Plan Mode in Cortex Code; approve **execution** of each plan.
- Statements run as **`BBC_OWNER`**.
- **Cost.** The task runs on `BBC_TRANSFORM_WH`, and only when the stream has data, which means only while telemetry is flowing. `OPEN_CASES` touches only the lots whose buckets changed.
- **Spike S2 decides the task form.**
  - If S2 passed, run `81_detection.sql` as written (triggered task).
  - If not, use the commented `SCHEDULE = '1 MINUTE'` variant in that file instead, and say so in the result log.

## Step 0: Pre-flight (terminal)
```bash
uv run bbc test sql snowflake/tests/05_semantic.sql
```
**Expected:** all PASS.

Then ask CoCo to execute:
```sql
SELECT param_key, param_value FROM BBC_OS.GOV.PARAMETERS
WHERE policy_version = BBC_OS.GOV.ACTIVE_POLICY_VERSION()
  AND param_key IN ('detection_window_min', 'near_tie_margin_usd', 'high_exposure_usd');
```
**Expected:** 60, 1000 and 100000. If `near_tie_margin_usd` isn't 1000, an older v1 is active: tell Claude, who will prepare policy v2.

## Step 1: Upload the new code (terminal)
```bash
uv run bbc deploy python
```
**What's new:**
- `bbc_toolkit` gains `cases.py` and the `OPEN_CASES` handler.
- `bbc_engine` gains the evaluation engine (it isn't called by any procedure until WP6b).
- The bundled contracts add the `DETENTION` cost type.

## Step 2: The detention cost rate (terminal)
```bash
uv run bbc sim init
uv run bbc ref load --reason "WP6a: truck detention at the Central Valley DC (inspection holds)"
```
**Expected:**
- `cost_rate` shows `inserted 1` with a ledger number. That is `COST-DETENTION-CVDC`, $100 per hour.
- Every other entity shows `no change`.
- If WP2 already loaded the current world, `cost_rate` shows `no change` too, which is also fine.

## Step 3: The decision store (CoCo)
> Run `snowflake/modules/80_decision_store.sql` against connection pndvhar-pt70809 as BBC_OWNER in Plan Mode. Any fix goes back into the file in the repo. Then run `SHOW TABLES IN SCHEMA BBC_OS.DECISION` and list the table names, and `SELECT kind, next_value FROM BBC_OS.DECISION.ID_COUNTERS ORDER BY kind`.

**Expected:**
- 16 tables.
- 11 id counters, each at 1.
- `EVIDENCE.EVIDENCE_PACKS` exists.

## Step 4: Detection (CoCo)
> Run `snowflake/modules/81_detection.sql` as BBC_OWNER in Plan Mode, using the S2 outcome for the task form. Then run `SHOW STREAMS IN SCHEMA BBC_OS.DECISION`, `SHOW TASKS IN SCHEMA BBC_OS.DECISION`, and `CALL BBC_OS.DECISION.OPEN_CASES();` once, and show me the results.

**Expected:**
- The stream has `stale = false` and the task has `state = started`.
- The manual call returns `"status": "OK"` with `"detected": 0`.
  - The new stream sees only changes made after it was created, so earlier S-A data opens nothing. Detection is driven by events.
  - If it returns `INVALID: no ACTIVE policy`, WP2's activation didn't happen.

## Step 5: A case opens by itself (terminal; plan task 5.3)
This step needs a scenario with new readings, and a departure after everything already sent.
- The SAP connector reads changes after its cursor. That cursor is already about 15 simulated hours past the S-A departure from WP5.
- So choose a departure **one day after the WP5 run**. For example, if you ran WP5 today, use tomorrow at 10:00 UTC.

```bash
BBC_STACK_SINK=snowflake corepack pnpm --filter @blueberrychain/dev-stack start      # leave running
# in a second terminal (replace the date):
uv run bbc sim run --scenario S-B --depart 2026-10-08T10:00:00Z --live-from-h 0.3
# in a third terminal, right away:
uv run python snowflake/spikes/wp6a_case_latency.py --lot L-B
```
**Expected:**
- **`bbc sim run`** sends the history fast up to +0.3 h, then runs live at 60×. The rule holds at about +0.6 h, roughly 20 seconds of wall time later.
- **`wp6a_case_latency.py`** prints the case (state `OPEN`, holder `PARTY-COASTLINE`, severity `MEDIUM`), then `case opened Ns after the reading reached Snowflake (within the 2-minute target)`.
- Stop `bbc sim run` with Ctrl-C after the case opens, or let it finish (about 15 minutes). While the excursion continues, the case is extended and never duplicated.

Note the seconds for the result log.

## Step 6: Tests (terminal)
```bash
uv run bbc test sql snowflake/tests/05_case_store.sql snowflake/tests/02_ledger.sql
```
**Expected:** all PASS. The checks:
- one open case per lot and per episode;
- every case is on the ledger as `CASE_OPENED`, with the facts it stores;
- a long breach in someone else's custody always has a case;
- id counters are ahead of every id handed out;
- only the owner writes the decision record, and only auditors read it;
- the stream is healthy, the task is started, and no detection run failed;
- the ledger chain still verifies.

## Step 7: Tell Claude
Say **"WP6a done"**, and paste:
- the outputs of steps 3 and 4;
- the latency from step 5;
- any file changes CoCo made;
- whether the task is triggered or scheduled (S2).

## If something goes wrong
| Symptom | Likely cause | What to do |
|---|---|---|
| `Unknown handler bbc_toolkit.snow.proc_open_cases` | Step 1 not run, or the procedure was created before the upload | Run `bbc deploy python`, then recreate the procedure (step 4) |
| `ref load` rejects `cost_rate` (`DETENTION` not allowed) | The deployed toolkit has the old contracts | Run step 1 first |
| Stream `stale = true`, or the test says missing or stale | `OPS.LOT_THERMAL_BUCKETS` was recreated after the stream | Re-run `81_detection.sql`; detection resumes with the next bucket change |
| Task never runs (`TASK_HISTORY` empty) | S2 outcome on this account; or the task is suspended | Use the scheduled variant; `ALTER TASK BBC_OS.DECISION.T_DETECT RESUME` |
| `TASK_HISTORY` shows FAILED | Error inside `OPEN_CASES` | Paste `error_message` to Claude; the run rolled back, and the stream wasn't consumed, so nothing is lost |
| Step 5: no case and no breach minutes for L-B | SAP or TMS records skipped (the departure was before an earlier run's end), so there is no lot or shipment | Re-run with a later `--depart`; check `OPS.LOTS` has L-B with the new harvest time |
| Step 5: latency well over 120 s | Dynamic Table lag, or the scheduled fallback | Paste the latency; Claude checks the refresh history of `LOT_THERMAL_BUCKETS` |

## Result log (fill in)
| Item | Result | Notes / changes CoCo made |
|---|---|---|
| Pre-flight: 05_semantic, policy parameters | | |
| bbc deploy python | | |
| ref load (cost_rate) | | |
| 80_decision_store.sql (tables, counters) | | |
| 81_detection.sql (triggered or scheduled; stream, task) | | |
| Manual OPEN_CASES call | | |
| S-B case opened: latency | | |
| bbc test sql 05_case_store + 02_ledger | | |
