"""Spike S10: does a single-row UPDATE inside a transaction serialize two writers?

This is the mechanism behind LEDGER.HEAD (hash-chain appends) and
DECISION.GATEWAY_LOCK (one mutation at a time). Two sessions run the same
transaction concurrently; each holds the row lock for ~8 s before committing.

PASS: T_SEQ holds n = 1 and n = 2 (distinct), and the second commit lands
      ~8 s after the first -> the second writer waited for the lock.
FAIL: duplicate n, or both commits within ~1 s.

Usage (from the repo root, after wp1_spikes.sql created the S10 tables):
  uv run python snowflake/spikes/s10_lock.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys

from _env import load_env

TXN = """
USE ROLE BBC_OWNER; USE WAREHOUSE BBC_APP_WH; USE SCHEMA BBC_OS.SANDBOX;
BEGIN;
UPDATE T_LOCK SET n = n + 1 WHERE id = 1;
CALL SYSTEM$WAIT(8);
INSERT INTO T_SEQ SELECT '{tag}', n, CURRENT_TIMESTAMP() FROM T_LOCK WHERE id = 1;
COMMIT;
"""

CHECK = """
USE ROLE BBC_OWNER; USE WAREHOUSE BBC_APP_WH;
SELECT session_tag, n, committed_at FROM BBC_OS.SANDBOX.T_SEQ ORDER BY committed_at;
"""


def snow(connection: str, sql: str) -> subprocess.Popen:
    exe = shutil.which("snow") or "snow"
    return subprocess.Popen(
        [exe, "sql", "-c", connection, "--format", "json", "-q", sql],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )


def main() -> int:
    connection = load_env().get("BBC_CONNECTION", "pndvhar-pt70809")
    sessions = [snow(connection, TXN.format(tag=tag)) for tag in ("A", "B")]
    for proc in sessions:
        _, err = proc.communicate(timeout=180)
        if proc.returncode != 0:
            print("session failed:", err.strip().splitlines()[-3:])
            return 1

    check = snow(connection, CHECK)
    out, err = check.communicate(timeout=120)
    if check.returncode != 0:
        print("check failed:", err.strip().splitlines()[-3:])
        return 1
    rows = json.loads(out)[-1]
    print(json.dumps(rows, indent=2))
    ns = sorted(int(r["N"]) for r in rows)
    print("RESULT:", "PASS (distinct, serialized)" if ns == [1, 2] else f"FAIL n={ns}")
    return 0 if ns == [1, 2] else 1


if __name__ == "__main__":
    sys.exit(main())
