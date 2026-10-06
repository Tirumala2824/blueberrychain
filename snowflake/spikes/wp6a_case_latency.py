"""WP6a checkpoint (plan task 5.3): a case opens within 2 minutes of the breach accumulating.

Read-only. Polls DECISION.CASES until a case holds the lot, then reports the in-account
latency: from the moment the reading that met the rule reached Snowflake (its
``received_at``) to the case's ``opened_at``. That is Dynamic Table lag + task start +
OPEN_CASES, independent of how fast the simulator sent the data.

    uv run python snowflake/spikes/wp6a_case_latency.py [--lot L-A] [--timeout-s 300]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from wp5_latency import query

QUERY = (
    "SELECT c.case_id, c.state, c.severity, c.holder_party_id_at_onset AS holder, "
    "TO_CHAR(c.onset_at) AS onset_at, TO_CHAR(c.opened_at) AS opened_at, "
    "DATEDIFF('second', ta.received_at, c.opened_at) AS latency_s "
    "FROM BBC_OS.DECISION.CASES c "
    "JOIN BBC_OS.DECISION.CASE_LOTS cl ON cl.case_id = c.case_id "
    "LEFT JOIN BBC_OS.OPS.TELEMETRY_ASSIGNED ta "
    "  ON ta.lot_id = cl.lot_id AND ta.reading_ts = cl.detected_at "
    "WHERE cl.lot_id = '{lot}' ORDER BY c.opened_at DESC LIMIT 1"
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lot", default="L-A")
    parser.add_argument("--timeout-s", type=int, default=300)
    parser.add_argument("-c", "--connection", default="pndvhar-pt70809")
    args = parser.parse_args()
    if not args.lot.replace("-", "").isalnum():
        raise SystemExit(f"not a lot id: {args.lot}")
    start = time.monotonic()
    while time.monotonic() - start < args.timeout_s:
        row = query(args.connection, QUERY.format(lot=args.lot))
        if row:
            latency = row.get("LATENCY_S")
            print(
                f"{row['CASE_ID']} {row['STATE']} severity={row['SEVERITY']} "
                f"holder={row['HOLDER']} onset={row['ONSET_AT']} opened={row['OPENED_AT']}"
            )
            if latency is None:
                print(
                    "opened, but the detecting reading is not in OPS.TELEMETRY_ASSIGNED (check WP3)"
                )
                return 1
            verdict = "within" if float(latency) <= 120 else "OVER"
            print(
                f"case opened {float(latency):.0f}s after the reading reached Snowflake "
                f"({verdict} the 2-minute target)"
            )
            return 0 if float(latency) <= 120 else 1
        print(f"{time.monotonic() - start:6.0f}s  no case for {args.lot} yet")
        time.sleep(10)
    print(
        f"no case after {args.timeout_s}s: check SHOW TASKS IN SCHEMA BBC_OS.DECISION and "
        "TASK_HISTORY for T_DETECT"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
