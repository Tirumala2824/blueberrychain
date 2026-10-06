"""`bbc ref load`, `bbc policy draft`, `bbc policy activate` - calls to governed procedures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from blueberrychain import snowcall
from blueberrychain.cli.world_cmds import DEFAULT_OUT, DEFAULT_POLICY

# Load order respects references (sites need parties, lanes need sites, ...).
LOAD_ORDER = [
    "PARTY",
    "SITE",
    "LANE",
    "PRODUCT",
    "CUSTOMER_SPEC",
    "CONTRACT",
    "CHANNEL_PRICE",
    "SENSOR",
    "COST_RATE",
]
APPLY = "CALL BBC_OS.API.APPLY_REFERENCE_CHANGE(?, ?, ?)"
DRAFT = "CALL BBC_OS.API.DRAFT_POLICY(?)"
ACTIVATE = "CALL BBC_OS.API.ACTIVATE_POLICY(?, ?)"


def _identity(parser: argparse.ArgumentParser, default: str) -> None:
    parser.add_argument(
        "--as",
        dest="identity",
        choices=snowcall.IDENTITIES,
        default=default,
        help=f"Who makes the call (default: {default}).",
    )


def add_ref_load(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--dir", type=Path, default=DEFAULT_OUT, help="Directory written by `bbc sim init`."
    )
    parser.add_argument(
        "--reason", default="world reference load", help="Change reason recorded in the ledger."
    )
    _identity(parser, "builder")


def run_ref_load(args: argparse.Namespace, runner=None) -> int:
    run = runner or snowcall.runner_for(args.identity)
    failures = 0
    for entity in LOAD_ORDER:
        path = args.dir / f"{entity.lower()}.json"
        if not path.exists():
            print(f"missing {path} - run `bbc sim init` first")
            return 2
        batch = json.loads(path.read_text(encoding="utf-8"))
        result = snowcall.call_json(run, APPLY, [entity, json.dumps(batch["records"]), args.reason])
        if result.get("status") == "OK":
            print(
                f"{entity:<14} inserted {result['inserted']:>3}  "
                f"unchanged {result['unchanged']:>3}  "
                + (f"ledger #{result['ledger_seq']}" if result["ledger_seq"] else "no change")
            )
        else:
            failures += 1
            print(f"{entity:<14} {result.get('status')}: {result.get('errors')}")
    return 0 if failures == 0 else 1


def add_policy_draft(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_POLICY)
    _identity(parser, "builder")


def run_policy_draft(args: argparse.Namespace, runner=None) -> int:
    run = runner or snowcall.runner_for(args.identity)
    document = args.path.read_text(encoding="utf-8")
    result = snowcall.call_json(run, DRAFT, [json.dumps(json.loads(document))])
    print(json.dumps(result, indent=2))
    return 0 if result.get("status") == "OK" else 1


def add_policy_activate(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("version")
    parser.add_argument("--reason", required=True)
    _identity(parser, "govadmin")


def run_policy_activate(args: argparse.Namespace, runner=None) -> int:
    run = runner or snowcall.runner_for(args.identity)
    result = snowcall.call_json(run, ACTIVATE, [args.version, args.reason])
    print(json.dumps(result, indent=2))
    return 0 if result.get("status") == "OK" else 1
