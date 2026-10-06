"""Dry run of the WP6a detection rule (read-only; creates nothing).

Runs ``bbc_toolkit.cases.DETECT_SQL`` - the query DECISION.OPEN_CASES executes - in
Snowflake over the WP3 thermal CTEs built from a simulated trip, cut off at successive
moments (as if the readings had arrived only up to then). At each cut-off it compares the
SQL's verdict - in excursion or not, onset, holder at onset, breach minutes - with the
Python reference (``blueberrychain.sim.assess.detect``), and reports when the case would open.

    uv run python snowflake/spikes/wp6a_detection_dryrun.py [--scenario S-A] [-c CONNECTION]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from bbc_toolkit import cases
from blueberrychain.sim import assess
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as w
from blueberrychain.sim.clock import iso, utc

sys.path.insert(0, str(Path(__file__).parent))
import wp3_thermal_dryrun as wp3

DEPART = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)
SHIPMENT = {"S-A": "SHP-A", "S-B": "SHP-B"}
POLICY = json.loads(
    (Path(__file__).resolve().parents[2] / "snowflake" / "seed" / "policy" / "v1.json").read_text(
        encoding="utf-8"
    )
)
WINDOW_MIN = POLICY["parameters"]["detection_window_min"]


def query(world, trip, messages, cutoff, scenario, connection):
    received = [m for m in messages if utc(m["ts"]) <= cutoff]
    lot = trip.lots[0]
    ctes = wp3.build_ctes(world, trip, received)
    # Detection's own inputs: the touched lot, the policy parameter, the lot on its shipment.
    on_shipment = (
        f"SHIPMENT_LOTS AS (SELECT {wp3.q(SHIPMENT[scenario])} AS shipment_id, "
        f"{wp3.q(lot.lot_id)} AS lot_id, {lot.kg} AS kg)"
    )
    ctes = [on_shipment if c.startswith("SHIPMENT_LOTS AS") else c for c in ctes]
    ctes += [
        f"detection_log AS (SELECT 'R' AS run_id, {wp3.q(lot.lot_id)} AS lot_id)",
        "gov_parameters AS (SELECT '1' AS policy_version, 'detection_window_min' AS param_key, "
        f"TO_VARIANT({WINDOW_MIN}) AS param_value)",
        f"SHIPMENTS AS (SELECT {wp3.q(SHIPMENT[scenario])} AS shipment_id, "
        f"IFF({wp3.q(iso(cutoff))}::TIMESTAMP_TZ >= {wp3.q(iso(DEPART))}::TIMESTAMP_TZ, "
        "'IN_TRANSIT', 'LOADING') AS status, "
        f"{wp3.q(iso(DEPART))}::TIMESTAMP_TZ AS planned_departure_at)",
    ]
    detect = (
        cases.DETECT_SQL.replace("BBC_OS.DECISION.DETECTION_LOG", "detection_log")
        .replace("BBC_OS.GOV.ACTIVE_POLICY_VERSION()", "'1'")
        .replace("BBC_OS.GOV.PARAMETERS", "gov_parameters")
        .replace("BBC_OS.REF.PRODUCTS", "ref_products")
        .replace("BBC_OS.REF.PARTIES", "ref_parties")
        .replace("BBC_OS.OPS.", "")
        .replace("run_id = ?", "run_id = 'R'")
    )
    assert detect.startswith("WITH ")
    sql = "WITH " + ",\n".join(ctes) + ",\n" + detect[len("WITH ") :]
    rows = wp3.run_sql(sql, connection)
    return rows[0] if rows else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="S-A", choices=["S-A", "S-B"])
    parser.add_argument(
        "--from-h", type=float, default=None, help="First cut-off (h after departure)."
    )
    parser.add_argument("--to-h", type=float, default=None)
    parser.add_argument("-c", "--connection", default="pndvhar-pt70809")
    args = parser.parse_args()
    span = {"S-A": (1.75, 2.1), "S-B": (0.4, 0.75)}[args.scenario]
    start_h = args.from_h if args.from_h is not None else span[0]
    end_h = args.to_h if args.to_h is not None else span[1]

    world = w.load_world()
    trip = tp.scenario_trip(world, args.scenario, DEPART)
    result = tm.simulate(world, trip)
    failures, opened = 0, None
    cutoff = DEPART + timedelta(hours=start_h)
    while cutoff <= DEPART + timedelta(hours=end_h):
        want = assess.detect(world, POLICY, trip, result.messages, cutoff)
        got = query(world, trip, result.messages, cutoff, args.scenario, args.connection)
        if want is None or got is None:
            ok = want is None and got is None
            detail = f"sql={'detect' if got else '-'} python={'detect' if want else '-'}"
        else:
            onset = utc(str(got["ONSET_AT"]).replace(" ", "T")) if got["ONSET_AT"] else None
            ok = (
                onset == want["onset_at"]
                and got["HOLDER_PARTY_ID"] == want["holder"]
                and abs(float(got["BREACH_MIN_IN_WINDOW"]) - want["breach_min"]) < 1e-6
                and got["SHIPMENT_ID"] == SHIPMENT[args.scenario]
            )
            detail = (
                f"onset sql={onset} python={want['onset_at']} holder={got['HOLDER_PARTY_ID']} "
                f"breach={got['BREACH_MIN_IN_WINDOW']} severity="
                f"{cases.Detection.from_row(list(got.values())).severity}"
            )
            opened = opened or cutoff
        failures += not ok
        h = (cutoff - DEPART).total_seconds() / 3600
        print(f"{'ok  ' if ok else 'FAIL'} +{h:4.2f} h  {detail}")
        cutoff += timedelta(minutes=5)
    when = f"+{(opened - DEPART).total_seconds() / 3600:.2f} h" if opened else "never"
    print(
        f"{args.scenario}: the rule first holds at {when} (the case opens about "
        f"{assess.DETECTION_LAG_MIN} min later); {failures} mismatch(es)"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
