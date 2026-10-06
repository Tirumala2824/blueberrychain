# WP5: The simulated world in Snowflake, and the semantic view

**Plan tasks:** 4.5 (semantic view `SEM.EXCURSION_RECOVERY`) and the 4.6 data checkpoint (an excursion is visible in Snowflake state within 2 minutes). **Depends on:** WP3 done and validated (all `03_*` tests green). **Unblocks:** Day 5 (case store and detection).

**What this does.**
1. **Runs the whole simulated world into Snowflake.** Mock SAP and mock TMS run with the IoT webhook and the SAP and carrier connectors in one local process (`apps/dev-stack`). The OPS Dynamic Tables fill with lots, shipments, custody, device pairings, orders, deliveries, stock and inspections, alongside the telemetry.
2. **Creates the semantic view**, where every governed metric is defined once:

| Module | Objects |
|---|---|
| `70_semantic_view.sql` | Views `SEM.CURRENT_PRODUCTS`, `SEM.CURRENT_PARTIES`, `SEM.CURRENT_SITES`, `SEM.INVENTORY_POSITIONS`; semantic view `SEM.EXCURSION_RECOVERY` (13 logical tables, 12 many-to-one relationships, 9 metrics) |

**`70_semantic_view.sql` is generated.**
- The source is `snowflake/semantic/excursion_recovery.yaml`; `uv run python -m blueberrychain.sqlgen` renders the SQL.
- The same YAML yields each governed metric's **definition hash**, which policy v1's `metric_registry` carries. `bbc policy check` fails if they disagree.
- **If CoCo has to change the DDL** (a syntax detail on this account), apply the fix to the `.sql` file so the run can continue, and **tell Claude the exact change**. Claude moves it into the YAML and the generator, so the YAML stays the source.

**Already proven locally.** With the in-memory sink, the same run landed 3,297 readings and 190 business events for S-A with no dead letters. S-B also ran clean, including its cross-dock handoff and the paperwork-versus-probe conflict.

## Before you start
- `.env` must contain `BBC_INGEST_PAT` and `BBC_IOT_HMAC_SECRET`.
- Run `uv run bbc sim init` once. It writes `.artifacts/sim/reference/sap_key_map.json`, which the SAP connector needs.
- **Policy v1 must carry the definition hashes.** Ask CoCo to execute:
  ```sql
  SELECT name, definition_hash FROM BBC_OS.GOV.METRIC_REGISTRY
  WHERE policy_version = BBC_OS.GOV.ACTIVE_POLICY_VERSION() AND canonical ORDER BY name;
  ```
  - **Expected:** `REMAINING_SHELF_LIFE_DAYS`, `EXCESS_LIFE_SHARE` and `QUALITY_ADJUSTED_ATP_KG` have a hash; the decision metrics are still NULL until WP6.
  - If every hash is NULL, WP2 activated an older v1. Tell Claude, who will prepare policy v2 (draft as builder, activate as govadmin, exactly as in WP2 step 6).

## Step 1: Run the world into Snowflake (terminal; plan task 4.3)
```bash
corepack pnpm -r build
BBC_STACK_SINK=snowflake corepack pnpm --filter @blueberrychain/dev-stack start      # leave running
# in a second terminal:
uv run bbc sim run --scenario S-A --reset --until-h 1.5
uv run python snowflake/spikes/wp5_latency.py
```
**Expected:**
- **`bbc sim run`** ends with `rejected 0`.
- **The run covers** the lots' history (harvest, packing, cold storage, the DC stock lots' inbound trips) and the first 1.5 h of the S-A haul. The compressor fails at +0.5 h.
- **`wp5_latency.py`** prints `excursion visible after Ns (within the 2-minute target)`. The carrier's custody of L-A now shows breach minutes.

Note the seconds for the result log.

## Step 2: The world is consistent (terminal)
```bash
uv run bbc test sql snowflake/tests/03_ops.sql snowflake/tests/04_world_consistency.sql
```
**Expected:** all PASS, now on real data. The checks cover:
- every lot, shipment, order line, delivery and device pairing references something real;
- every lot has its probe from harvest, and every departed shipment has its reefer;
- custody runs load → unload;
- organic orders get organic lots;
- per-reading physics equals the UDF;
- custody shares sum to 1;
- nothing was dead-lettered.

## Step 3: The semantic view (CoCo, `$semantic-view`)
> Using $semantic-view, run `snowflake/modules/70_semantic_view.sql` as BBC_OWNER in Plan Mode. Keep every table, relationship, fact, dimension and metric, and every expression as written. If the account rejects a clause, show me the error and propose the smallest syntax change, apply it to the file, and list it. The likely ones are `NON ADDITIVE BY`, `WITH SYNONYMS` and `AI_SQL_GENERATION`. Then run `DESCRIBE SEMANTIC VIEW BBC_OS.SEM.EXCURSION_RECOVERY` and show the METRIC rows.

**Expected:**
- 9 metrics: `REMAINING_SHELF_LIFE_DAYS`, `EXCESS_LIFE_SHARE`, `QUALITY_ADJUSTED_ATP_KG`, `TEMPERATURE_COMPLIANCE_PCT`, `MONITORING_COVERAGE_PCT`, `THERMAL_EXPOSURE_DEG_H`, `DATA_AGE_MIN`, `KG_ON_SHIPMENTS`, `ORDER_VALUE_USD`.
- **If `NON ADDITIVE BY` is not supported** on this account, don't drop it silently. Tell Claude. The fallback is to give `QUALITY_ADJUSTED_ATP_KG` a base view that keeps only each site's latest snapshot, with a plain SUM over it.

**Smoke query.** Ask CoCo to execute:
```sql
SELECT * FROM SEMANTIC_VIEW(
  BBC_OS.SEM.EXCURSION_RECOVERY
  DIMENSIONS lots.lot_id, holders.holder_type
  METRICS custody_exposure.excess_life_share, custody_exposure.thermal_exposure_deg_h)
ORDER BY lot_id, holder_type;
```
**Expected:** for L-A, the CARRIER holds nearly all of the attributable excess, and the GROWER share is 0. Field heat inside the contractual pre-cool window doesn't count.

## Step 4: Tests (terminal)
```bash
uv run bbc test sql snowflake/tests/05_semantic.sql
```
**Expected:** all PASS. The checks:
- every governed metric in the active policy is a metric of the view;
- shelf life, compliance and custody shares through the view equal the Dynamic Tables exactly;
- total ATP equals ATP at each lot's latest snapshot, so stock is never summed across snapshots.

## Step 5: Finish the haul (optional; terminal)
```bash
uv run bbc sim run --scenario S-A --live-from-h 1.5
```
This runs the rest of S-A in real time at 60×, so 13.5 simulated hours take about 14 minutes. Watch `OPS.SHIPMENTS` move through the junction and arrive. Stop the dev stack with Ctrl-C when done, and pause the Dynamic Tables (WP3 step 8) if you're stopping for the day.

## Step 6: Tell Claude
Say **"WP5 done"**, and paste:
- the latency from step 1;
- any changes CoCo made to `70_semantic_view.sql`;
- the METRIC rows from step 3;
- the smoke query output.

## If something goes wrong
| Symptom | Likely cause | What to do |
|---|---|---|
| dev-stack: `BBC_INGEST_PAT is not set` | `.env` missing the ingest token | Add it (WP1 step 2) |
| dev-stack: `ENOENT ... sap_key_map.json` | `bbc sim init` not run | Run it, then restart the stack |
| `bbc sim run`: `connection refused` | The dev stack isn't running, or uses other ports | Start it first; it listens on 4004, 4005, 8787 and 8790 |
| `wp5_latency.py` never sees breach minutes | Dynamic Tables suspended, or no pairing landed | `SHOW DYNAMIC TABLES IN SCHEMA BBC_OS.OPS`; check `OPS.DEVICE_ASSIGNMENTS` has `P-A1 -> L-A` |
| `04_world_consistency` fails "reefer paired from departure" | The run stopped between departure and the pairing call | Re-run `bbc sim run` with the same arguments; it's idempotent |
| `70_semantic_view.sql` fails on a table reference | A Dynamic Table from WP3 is missing | Re-check WP3 step 4 |

## Result log (fill in)
| Item | Result | Notes / changes CoCo made |
|---|---|---|
| Policy v1 definition hashes present | | |
| bbc sim run (S-A to +1.5 h) | | |
| Latency: excursion visible after | | |
| 03_ops + 04_world_consistency | | |
| 70_semantic_view.sql | | |
| DESCRIBE: metric rows | | |
| Smoke query (L-A custody shares) | | |
| 05_semantic | | |
