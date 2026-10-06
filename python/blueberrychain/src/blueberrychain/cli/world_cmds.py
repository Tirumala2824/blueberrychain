"""`bbc sim init` and `bbc policy check` - offline commands (no Snowflake connection)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from bbc_toolkit.policy import check_policy

from blueberrychain import semantic
from blueberrychain.sim import world as world_mod

DEFAULT_OUT = Path(".artifacts/sim/reference")
DEFAULT_POLICY = Path("snowflake/seed/policy/v3.json")  # the current policy seed


def add_sim_init(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--world", type=Path, default=None, help="World config (default: bundled world.yaml)."
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help=f"Output directory (default: {DEFAULT_OUT})."
    )


def run_sim_init(args: argparse.Namespace) -> int:
    try:
        world = world_mod.load_world(args.world)
        batches = world_mod.reference_batches(world)
    except world_mod.WorldError as exc:
        print(exc)
        return 1
    paths = world_mod.write_batches(batches, args.out, world["meta"]["version"])
    for path in paths:
        count = len(json.loads(path.read_text(encoding="utf-8"))["records"])
        print(f"{path.as_posix():<55} {count:>4} records")
    key_map = world_mod.write_key_map(world, args.out)
    print(f"{key_map.as_posix():<55} SAP key map")
    print(f"world '{world['meta']['name']}' v{world['meta']['version']} is valid")
    return 0


def add_policy_check(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "path", nargs="?", type=Path, default=DEFAULT_POLICY, help="Policy document (JSON)."
    )


def run_policy_check(args: argparse.Namespace) -> int:
    doc = json.loads(args.path.read_text(encoding="utf-8"))
    problems = check_policy(doc)
    if not problems:  # governed metric definitions must match the semantic model
        problems = semantic.policy_hash_problems(doc, semantic.load_model())
    for problem in problems:
        print(f"  {problem}")
    if problems:
        print(f"policy {doc.get('policy_version', '?')}: {len(problems)} problem(s)")
        return 1
    print(f"policy {doc['policy_version']} is valid and activatable")
    return 0
