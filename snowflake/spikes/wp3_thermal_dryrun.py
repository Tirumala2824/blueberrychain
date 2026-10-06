"""Dry run of the WP3 thermal SQL against inline simulator data (read-only; creates nothing).

Takes the Dynamic Table bodies from snowflake/modules/62_ops_thermal.sql verbatim,
replaces their source tables with CTEs built from a simulated trip, runs the query
in Snowflake and compares every lot and custody-holder figure with
bbc_engine.physics on the same readings.

    uv run python snowflake/spikes/wp3_thermal_dryrun.py [--scenario S-A] [-c CONNECTION]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from bbc_engine import physics as ph
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as w
from blueberrychain.sim.clock import iso, utc

ROOT = Path(__file__).resolve().parents[2]
THERMAL_SQL = ROOT / "snowflake" / "modules" / "62_ops_thermal.sql"
BODIES = [
    "LOT_CUSTODY",
    "TELEMETRY_ASSIGNED",
    "LOT_THERMAL_BUCKETS",
    "LOT_THERMAL_STATE",
    "LOT_CUSTODY_EXPOSURE",
]
DEPART = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)


def dt_bodies(text: str) -> dict[str, str]:
    bodies = {}
    for m in re.finditer(r"CREATE OR REPLACE DYNAMIC TABLE (\w+)\n.*?\nAS\n(.*?);\n", text, re.S):
        bodies[m.group(1)] = m.group(2)
    return bodies


def q(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def build_query(world, trip, messages) -> str:
    lot = trip.lots[0]
    product = next(p for p in world["products"] if p["product_id"] == lot.product_id)
    probe = [m for m in messages if m["device_id"] == lot.probe_device_id]
    telemetry = ",\n".join(
        f"({q(m['device_id'])}, {q(m['ts'])}, {m['interval_s']}, {q(json.dumps(m['values']))})"
        for m in probe
    )
    # Custody: the grower holds the lot from harvest; each change of holder is a handoff event.
    events, holder = [], lot.grower_party_id
    for i, seg in enumerate(lot.segments):
        if seg.holder_party_id != holder:
            events.append(
                (f"CE-{i}", iso(seg.start), holder, seg.holder_party_id, seg.site_id or "")
            )
            holder = seg.holder_party_id
    custody = ",\n".join(
        f"({q(e)}, 'HANDOFF', {q(at)}::TIMESTAMP_TZ, NULL, {q(lot.lot_id)}, {q(f)}, {q(t)}, {q(s)})"
        for e, at, f, t, s in events
    )
    parties = ",\n".join(
        f"({q(p['party_id'])}, {q(p['party_type'])}, TRUE)" for p in world["parties"]
    )
    contracts = ",\n".join(
        f"({q(c['party_id'])}, {q(c['contract_type'])}, {q(json.dumps(c['terms']))})"
        for c in world["contracts"]
    )
    ctes = [
        "raw_telemetry AS (SELECT column1 AS device_id, column2::TIMESTAMP_TZ AS reading_ts, "
        "column3 AS interval_s, PARSE_JSON(column4) AS readings, 'k' AS idempotency_key, "
        f"CURRENT_TIMESTAMP() AS received_at FROM VALUES\n{telemetry})",
        "DEVICE_ASSIGNMENTS AS (SELECT 'A-1' AS assignment_id, "
        f"{q(lot.probe_device_id)} AS device_id, 'LOT' AS target_type, "
        f"{q(lot.lot_id)} AS target_id, 'PRIMARY' AS role, "
        f"{q(iso(lot.harvest_at))}::TIMESTAMP_TZ AS assigned_from, "
        "NULL::TIMESTAMP_TZ AS assigned_to)",
        "CUSTODY_EVENTS AS (SELECT column1 AS event_id, column2 AS event_type, column3 AS at, "
        "column4::STRING AS shipment_id, column5 AS lot_id, column6 AS from_party_id, "
        f"column7 AS to_party_id, NULLIF(column8, '') AS site_id FROM VALUES\n{custody})",
        "SHIPMENT_LOTS AS (SELECT NULL::STRING AS shipment_id, NULL::STRING AS lot_id, "
        "0 AS kg WHERE FALSE)",
        f"LOTS AS (SELECT {q(lot.lot_id)} AS lot_id, {q(lot.product_id)} AS product_id, "
        f"{q(lot.grower_party_id)} AS grower_party_id, {lot.kg} AS kg, "
        f"{q(iso(lot.harvest_at))}::TIMESTAMP_TZ AS harvest_at)",
        f"ref_products AS (SELECT {q(product['product_id'])} AS product_id, 1 AS version, "
        "TRUE AS is_current, "
        f"{product['ref_shelf_life_days']}::NUMBER(6,2) AS ref_shelf_life_days, "
        f"{product['tref_c']}::NUMBER(5,2) AS tref_c, {product['q10']}::NUMBER(6,3) AS q10, "
        f"{product['threshold_c']}::NUMBER(5,2) AS threshold_c, "
        f"{product['unmonitored_assumed_temp_c']}::NUMBER(5,2) AS unmonitored_assumed_temp_c)",
        "ref_parties AS (SELECT column1 AS party_id, column2 AS party_type, column3 AS is_current "
        f"FROM VALUES\n{parties})",
        "ref_contracts AS (SELECT column1 AS party_id, column2 AS contract_type, "
        f"PARSE_JSON(column3) AS terms, TRUE AS is_current FROM VALUES\n{contracts})",
    ]
    bodies = dt_bodies(THERMAL_SQL.read_text(encoding="utf-8"))
    for name in BODIES:
        body = (
            bodies[name]
            .replace("BBC_OS.RAW.TELEMETRY", "raw_telemetry")
            .replace("BBC_OS.REF.PRODUCTS", "ref_products")
            .replace("BBC_OS.REF.PARTIES", "ref_parties")
            .replace("BBC_OS.REF.CONTRACTS", "ref_contracts")
        )
        ctes.append(f"{name} AS (\n{body}\n)")
    select = (
        "SELECT 'STATE' AS kind, OBJECT_CONSTRUCT(*) AS rec FROM LOT_THERMAL_STATE\n"
        "UNION ALL SELECT 'EXPOSURE', OBJECT_CONSTRUCT(*) FROM LOT_CUSTODY_EXPOSURE"
    )
    return "WITH " + ",\n".join(ctes) + "\n" + select


def run_sql(sql: str, connection: str) -> list[dict]:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", encoding="utf-8", delete=False) as handle:
        handle.write(sql)
    try:
        proc = subprocess.run(
            [
                shutil.which("snow") or "snow",
                "sql",
                "-c",
                connection,
                "--format",
                "json",
                "--enable-templating",
                "NONE",
                "-f",
                handle.name,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    finally:
        Path(handle.name).unlink()
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout)
    return json.loads(proc.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="S-A", choices=["S-A", "S-B"])
    parser.add_argument("-c", "--connection", default="pndvhar-pt70809")
    args = parser.parse_args()

    world = w.load_world()
    trip = tp.scenario_trip(world, args.scenario, DEPART)
    result = tm.simulate(world, trip)
    lot = trip.lots[0]
    product = next(p for p in world["products"] if p["product_id"] == lot.product_id)
    model = ph.ShelfLifeModel.from_product(product)
    readings = []
    for m in result.messages:
        if m["device_id"] != lot.probe_device_id:
            continue
        ts = utc(m["ts"])
        seg = lot.segment_at(ts - timedelta(seconds=1))  # the holder during the interval it closes
        readings.append(ph.Reading(ts, m["interval_s"], m["values"]["pulp_c"], seg.holder_party_id))
    expected_state = ph.lot_state(model, lot.harvest_at, readings)
    grower = next(
        c
        for c in world["contracts"]
        if c["party_id"] == lot.grower_party_id and c["contract_type"] == "GROWER_SUPPLY"
    )
    window_end = lot.harvest_at + timedelta(hours=grower["terms"]["precool_max_hours"])
    expected_exposure = ph.custody_exposure(readings, model, attributable_after=window_end)

    rows = run_sql(build_query(world, trip, result.messages), args.connection)
    state = next(json.loads(r["REC"]) for r in rows if r["KIND"] == "STATE")
    exposure = {
        e["HOLDER_PARTY_ID"]: e
        for e in (json.loads(r["REC"]) for r in rows if r["KIND"] == "EXPOSURE")
    }

    checks = [
        ("readings", state["READINGS"], len(readings)),
        ("consumed_h", state["CONSUMED_H"], expected_state.consumed_h),
        ("excess_h", state["EXCESS_H"], expected_state.excess_h),
        ("breach_min", state["BREACH_MIN"], expected_state.breach_min),
        ("degree_min_above", state["DEGREE_MIN_ABOVE"], expected_state.degree_min_above),
        ("elapsed_h", state["ELAPSED_H"], expected_state.elapsed_h),
        ("unmonitored_h", state["UNMONITORED_H"], expected_state.unmonitored_h),
        (
            "remaining_shelf_life_days",
            state["REMAINING_SHELF_LIFE_DAYS"],
            expected_state.remaining_shelf_life_days,
        ),
        (
            "monitoring_coverage_pct",
            state["MONITORING_COVERAGE_PCT"],
            expected_state.monitoring_coverage_pct,
        ),
        (
            "temperature_compliance_pct",
            state["TEMPERATURE_COMPLIANCE_PCT"],
            expected_state.temperature_compliance_pct,
        ),
    ]
    for holder, e in expected_exposure.items():
        got = exposure.get(holder, {})
        checks.append((f"excess_h[{holder}]", got.get("EXCESS_H"), e.excess_h))
        checks.append(
            (
                f"attributable_excess_h[{holder}]",
                got.get("ATTRIBUTABLE_EXCESS_H"),
                e.attributable_excess_h,
            )
        )
        checks.append(
            (f"excess_life_share[{holder}]", got.get("EXCESS_LIFE_SHARE"), e.excess_life_share)
        )
    failures = 0
    for name, got, want in checks:
        ok = (got is None and want is None) or (
            got is not None
            and want is not None
            and abs(float(got) - float(want)) <= 1e-6 * max(1.0, abs(want))
        )
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {name:<38} sql={got}  python={want}")
    print(f"{args.scenario}: {len(checks) - failures}/{len(checks)} figures match")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
