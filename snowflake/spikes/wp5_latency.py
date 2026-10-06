"""Day 4 data checkpoint (plan task 4.6): how long until an excursion is visible in OPS?

Run right after `bbc sim run` has delivered the readings that cross the threshold.
Read-only: it polls OPS.LOT_CUSTODY_EXPOSURE until the lot shows breach minutes in
the carrier's custody, and reports the wall-clock time that took (target: <= 2 min,
i.e. the 1-minute Dynamic Table lag plus refresh time).

    uv run python snowflake/spikes/wp5_latency.py [--lot L-A] [--holder PARTY-SIERRA]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time

QUERY = (
    "SELECT COALESCE(SUM(breach_min), 0) AS breach_min, "
    "COALESCE(SUM(attributable_excess_h), 0) AS excess_h "
    "FROM BBC_OS.OPS.LOT_CUSTODY_EXPOSURE "
    "WHERE lot_id = '{lot}' AND holder_party_id = '{holder}'"
)


def query(connection: str, sql: str) -> dict:
    proc = subprocess.run(
        [shutil.which("snow") or "snow", "sql", "-c", connection, "--format", "json", "-q", sql],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout)
    rows = json.loads(proc.stdout)
    return rows[0] if rows else {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lot", default="L-A")
    parser.add_argument("--holder", default="PARTY-SIERRA")
    parser.add_argument("--timeout-s", type=int, default=300)
    parser.add_argument("-c", "--connection", default="pndvhar-pt70809")
    args = parser.parse_args()
    for value in (args.lot, args.holder):
        if not value.replace("-", "").isalnum():
            raise SystemExit(f"not an id: {value}")
    start = time.monotonic()
    while time.monotonic() - start < args.timeout_s:
        row = query(args.connection, QUERY.format(lot=args.lot, holder=args.holder))
        elapsed = time.monotonic() - start
        breach = float(row.get("BREACH_MIN") or 0)
        excess = float(row.get("EXCESS_H") or 0)
        print(f"{elapsed:6.0f}s  breach_min={breach:g}  attributable_excess_h={excess:.3f}")
        if breach > 0:
            verdict = "within" if elapsed <= 120 else "OVER"
            print(f"excursion visible after {elapsed:.0f}s ({verdict} the 2-minute target)")
            return 0 if elapsed <= 120 else 1
        time.sleep(10)
    print(
        f"not visible after {args.timeout_s}s: check SHOW DYNAMIC TABLES (scheduling_state) "
        "and RAW.TELEMETRY"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
