# WP3: Ingest path and OPS Dynamic Tables

**Plan tasks:** 3.5 (OPS layer), with the ingest procedures moved here from WP2, plus the 3.3 checkpoint (simulated readings land in RAW, and replaying them adds nothing). **Depends on:**
- WP2 done and validated (all `02_*` SQL tests green);
- spike S1 (ASOF JOIN in an incremental Dynamic Table) and S4 (Python runtime) recorded in ADR-0002.

**Unblocks:** Day 4 (business systems inbound, semantic view) and Day 5 (case store and detection).

**What this builds.**
- **One way into RAW:** a procedure that validates, de-duplicates and dead-letters each row, and commits the cursor with the data.
- **Typed operational facts:** lots, shipments, custody, device assignments, orders, deliveries, stock, QC and counterparty responses.
- **Thermal state:** computed continuously at the right grain, using the same physics as `bbc_engine`.

| Module | Objects |
|---|---|
| `55_ingest.sql` | `API.INGEST_BATCH`, `API.GET_CONNECTOR_STATE`; `BBC_INGEST` gets USAGE on these two and nothing else |
| `60_ops_functions.sql` | `OPS.SHELF_LIFE_RATE`, `OPS.PROJECT_SHELF_LIFE_DAYS` (SQL, IMMUTABLE) |
| `61_ops_typed.sql` | 10 Dynamic Tables: `LOTS`, `SHIPMENTS`, `SHIPMENT_LOTS`, `CUSTODY_EVENTS`, `DEVICE_ASSIGNMENTS`, `ORDER_LINES`, `DELIVERIES`, `INVENTORY_SNAPSHOTS`, `QC_INSPECTIONS`, `COUNTERPARTY_RESPONSES` |
| `62_ops_thermal.sql` | 6 Dynamic Tables: `LOT_CUSTODY`, `TELEMETRY_ASSIGNED`, `REEFER_TELEMETRY`, `LOT_THERMAL_BUCKETS`, `LOT_THERMAL_STATE`, `LOT_CUSTODY_EXPOSURE` |

**Already proven before this brief.** `snowflake/spikes/wp3_thermal_dryrun.py` ran the thermal Dynamic Table SQL from `62_ops_thermal.sql`, unchanged, as a read-only query over simulated S-A and S-B trips.
- Every lot and custody figure matched `bbc_engine.physics` to within 1e-6: 19/19 for S-A, 22/22 for S-B.
- That run settled three Snowflake details: `TIME_SLICE` has no `TIMESTAMP_TZ` form; ASOF filtering behaves as intended; JSON timestamps ending in 'Z' cast correctly.

What's left to confirm in the account is that the tables **create, schedule and refresh**.

**Who runs what.** Steps 2, 3 and 4 run in **Cortex Code**. Steps 1, 5, 6 and 7 run in a **terminal** at the repo root.

## Before you start
- Plan Mode in Cortex Code; approve **execution** of each plan.
- Statements run as **`BBC_OWNER`**.
- **Cost:** Dynamic Tables refresh on `BBC_TRANSFORM_WH` (X-Small) with a 1-minute target lag. Refreshes are skipped while RAW doesn't change, so cost accrues only while the simulator is sending. Pause them between sessions with step 8.
- **Spike S1 decides the join form.**
  - If S1 found that ASOF JOIN works in an incremental Dynamic Table, run `62_ops_thermal.sql` as written.
  - If not, apply the interval-join fallback described at the end of that file first, and tell Claude, who will re-run the dry run on the fallback.

## Step 0: Pre-flight
```bash
uv run bbc test sql snowflake/tests/02_ledger.sql snowflake/tests/02_reference.sql snowflake/tests/02_policy.sql
```
**Expected:** all PASS. If not, WP2 isn't finished: stop.

## Step 1: Upload the new toolkit (terminal)
```bash
uv run bbc deploy python
```
`bbc_toolkit` gained the ingest module. The upload overwrites `0.1.0`, and the WP2 procedures pick up the same code on their next call; their behaviour is unchanged.

## Step 2: Ingest procedures (CoCo)
> Run `snowflake/modules/55_ingest.sql` against connection pndvhar-pt70809 in Plan Mode. Apply the S4 runtime decision as in WP2 (RUNTIME_VERSION). Any fix goes back into the file in the repo.

## Step 3: Physics functions (CoCo)
> Run `snowflake/modules/60_ops_functions.sql` in Plan Mode.

## Step 4: Dynamic Tables (CoCo, `$dynamic-tables`)
> Using $dynamic-tables, create the Dynamic Tables in `snowflake/modules/61_ops_typed.sql`, then those in `snowflake/modules/62_ops_thermal.sql`, in file order, as BBC_OWNER. Don't change the SELECT logic. If a table fails to create, show me the error and propose the smallest fix; apply it to the file in the repo. Then run `SHOW DYNAMIC TABLES IN SCHEMA BBC_OS.OPS` and give me, for every table: refresh_mode, refresh_mode_reason, target_lag and scheduling_state.

**Expected:**
- 16 Dynamic Tables, all with `scheduling_state = ACTIVE`.
- Paste the refresh modes into the result log.
  - `INCREMENTAL` is the goal for the high-volume path: `TELEMETRY_ASSIGNED`, `LOT_THERMAL_BUCKETS`, `REEFER_TELEMETRY`.
  - `FULL` is acceptable for the small typed tables and `LOT_CUSTODY_EXPOSURE`.
  - Whenever a table falls back to FULL, `refresh_mode_reason` says why. Claude uses that to decide whether to restructure.

## Step 5: The connector identity works end to end (terminal)
`.env` must contain `BBC_INGEST_PAT` (from WP1 step 2).
```bash
BBC_IT=1 corepack pnpm --filter @blueberrychain/connector-sdk test
```
**Expected:** the live test "lands a batch once, then replays it as duplicates" passes. It writes one reading for device `P-IT` (connector `it-connector-sdk`); RAW is append-only, so that row stays as a test record. No device assignment covers it, so it never reaches lot physics.

## Step 6: Simulated readings through the webhook (terminal; plan task 3.3)
Set `BBC_IOT_HMAC_SECRET` in `.env` to any long random string, then:
```bash
corepack pnpm -r build
corepack pnpm --filter @blueberrychain/connector-iot start          # leave running
# in a second terminal:
uv run bbc sim telemetry --scenario S-A --from-h 0 --minutes 10 --out .artifacts/sim/s-a-10min.jsonl --to http://127.0.0.1:8787/v1/telemetry
uv run bbc sim telemetry --replay .artifacts/sim/s-a-10min.jsonl --to http://127.0.0.1:8787/v1/telemetry
curl http://127.0.0.1:8787/healthz
```
**Expected:**
- Both runs print `accepted 3, rejected 0`.
- `/healthz` shows `"inserted": 3, "duplicates": 3`.

Then ask CoCo to execute:
```sql
SELECT device_id, reading_ts, readings:pulp_c::FLOAT AS pulp_c, readings:supply_air_c::FLOAT AS supply_air_c
FROM BBC_OS.RAW.TELEMETRY WHERE connector_id = 'iot-webhook' ORDER BY reading_ts, device_id;
SELECT COUNT(*) FROM BBC_OS.RAW.INGEST_ERRORS;
```
**Expected:** exactly 3 rows (P-A1 at departure and +5 min, RF-114 at +5 min), and 0 ingest errors.

The OPS physics tables stay empty for now. Lots, device assignments and custody arrive as business events through the mock SAP and TMS on Day 4. That is expected.

## Step 7: Tests (terminal)
```bash
uv run bbc test sql snowflake/tests/03_physics_parity.sql snowflake/tests/03_ops.sql
```
**Expected:** all PASS.
- **Physics:** the SQL functions reproduce `bbc_engine.physics`.
- **Ingest:** connectors hold no table privileges; every stored key is the canonical hash of its device and instant; no duplicates.
- **OPS:** the remaining checks pass trivially until Day 4 data arrives.
- **Dynamic Tables:** every one is ACTIVE.

## Step 8: Pause between sessions (cost)
To pause, ask CoCo to run `ALTER DYNAMIC TABLE BBC_OS.OPS.<name> SUSPEND;` for all 16 tables. To resume, use `RESUME`.

While the tables are suspended, the last test in `03_ops.sql` fails on purpose.

## Step 9: Tell Claude
Say **"WP3 done"**, and paste:
- the refresh-mode table from step 4;
- any file changes CoCo made;
- the output of steps 5 and 6.

## If something goes wrong
| Symptom | Likely cause | What to do |
|---|---|---|
| `Unsupported feature 'ASOF JOIN'` or the DT is forced to FULL by ASOF | S1 outcome on this account | Use the interval-join fallback at the end of `62_ops_thermal.sql`; Claude re-runs the dry run |
| `Function TIME_SLICE does not support TIMESTAMP_TZ` | An old copy of the file | Pull the repo: buckets slice `CONVERT_TIMEZONE('UTC', reading_ts)::TIMESTAMP_NTZ` |
| Step 5 or 6: HTTP 401 / 390xxx | `BBC_INGEST_PAT` missing or expired | Check `.env`; regenerate the token as in WP1 step 2 |
| Step 6: `webhook refused the batch (401)` | `BBC_IOT_HMAC_SECRET` differs between the two terminals | Both processes read `.env`; restart the webhook after editing it |
| Step 6: `503` and lines in `.artifacts/dead-letter/iot-webhook.jsonl` | The webhook couldn't reach Snowflake | Fix the cause, then replay with `bbc sim telemetry --replay` (it's idempotent) |
| `INGEST_BATCH` returns `PARTIAL` | Some rows broke their contract | The reasons are in `RAW.INGEST_ERRORS.errors`; paste them to Claude |

## Result log (fill in)
| Item | Result | Notes / changes CoCo made |
|---|---|---|
| bbc deploy python | | |
| 55_ingest.sql | | |
| 60_ops_functions.sql | | |
| 61_ops_typed.sql (refresh modes) | | |
| 62_ops_thermal.sql (refresh modes; ASOF or fallback) | | |
| Connector identity live test | | |
| Webhook: first run / replay / RAW rows | | |
| bbc test sql 03_* | | |
