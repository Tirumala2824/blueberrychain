# /// script
# requires-python = ">=3.11"
# dependencies = ["snowflake-connector-python>=3.12", "cryptography>=42"]
# ///
"""BlueberryChain IoT ledger CLI.

  uv run demo/bbc.py setup                       register logger public keys (install time)
  uv run demo/bbc.py skills                      list the CoCo skills in .cortex/skills
  uv run demo/bbc.py ingest [--run RUN_ID]       INPUT: land the gateway dump
  uv run demo/bbc.py skill run <name> [--run latest]
  uv run demo/bbc.py report [--run latest]       read the signed attestation back from Snowflake
"""
from __future__ import annotations

import argparse
import io
import sys
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="\n", line_buffering=True)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from iot_ledger import anomaly, common as c, gateway, report, sync, validate  # noqa: E402

SKILLS = {
    "ledger-integrity-validator": validate.run,
    "coldchain-anomaly-detector": anomaly.run,
    "snowflake-audit-sync": sync.run,
}


def list_skills() -> None:
    root = c.REPO_DIR / ".cortex" / "skills"
    c.section(f"CoCo project skills  ({root.relative_to(c.REPO_DIR).as_posix()}/)")
    for i, name in enumerate(SKILLS, 1):
        text = (root / name / "SKILL.md").read_text(encoding="utf-8")
        front = text.split("---")[1]
        desc = next(l.split(":", 1)[1].strip() for l in front.splitlines() if l.startswith("description:"))
        c.out(f"  {c.GREEN}{c.BOLD}{i}  ${name:<28}{c.RESET} {c.DIM}{desc[:74]}{'…' if len(desc) > 74 else ''}{c.RESET}")
        c.pause(0.3)
    c.out()


def main() -> None:
    p = argparse.ArgumentParser(prog="bbc")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup")
    sub.add_parser("skills")
    pi = sub.add_parser("ingest")
    pi.add_argument("--run", default=None)
    ps = sub.add_parser("skill")
    ps.add_argument("action", choices=["run"])
    ps.add_argument("name", choices=list(SKILLS))
    ps.add_argument("--run", default="latest")
    pr = sub.add_parser("report")
    pr.add_argument("--run", default="latest")
    a = p.parse_args()

    if a.cmd == "setup":
        gateway.setup()
    elif a.cmd == "skills":
        list_skills()
    elif a.cmd == "ingest":
        gateway.ingest(a.run or "RUN-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    elif a.cmd == "report":
        report.run(a.run)
    else:
        SKILLS[a.name](a.run)


if __name__ == "__main__":
    main()
