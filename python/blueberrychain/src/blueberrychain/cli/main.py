"""`bbc` - the BlueberryChain OS command line."""

from __future__ import annotations

import argparse
import sys

from blueberrychain import __version__
from blueberrychain.cli import deploy, governed_cmds, test_sql, world_cmds


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bbc", description="BlueberryChain OS command line.")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("version", help="Print the CLI version.")

    test = commands.add_parser("test", help="Run test suites.")
    test_kinds = test.add_subparsers(dest="test_kind", required=True)
    sql = test_kinds.add_parser(
        "sql",
        help="Run Snowflake SQL assertion tests (a test passes when its last "
        "statement returns zero rows).",
    )
    test_sql.add_arguments(sql)

    sim = commands.add_parser("sim", help="World simulator.")
    sim_cmds = sim.add_subparsers(dest="sim_command", required=True)
    world_cmds.add_sim_init(
        sim_cmds.add_parser("init", help="Validate the world and write reference batches.")
    )

    deploy_cmd = commands.add_parser("deploy", help="Deploy artifacts to Snowflake.")
    deploy_kinds = deploy_cmd.add_subparsers(dest="deploy_kind", required=True)
    deploy.add_arguments(
        deploy_kinds.add_parser(
            "python", help="Package bbc_toolkit / bbc_engine and upload to the code stage."
        )
    )

    policy = commands.add_parser("policy", help="Policy documents.")
    policy_cmds = policy.add_subparsers(dest="policy_command", required=True)
    world_cmds.add_policy_check(
        policy_cmds.add_parser("check", help="Validate a policy document (schema + semantics).")
    )
    governed_cmds.add_policy_draft(
        policy_cmds.add_parser(
            "draft", help="Store a policy document as a DRAFT (API.DRAFT_POLICY)."
        )
    )
    governed_cmds.add_policy_activate(
        policy_cmds.add_parser("activate", help="Activate a DRAFT policy (API.ACTIVATE_POLICY).")
    )

    ref = commands.add_parser("ref", help="Reference data.")
    ref_cmds = ref.add_subparsers(dest="ref_command", required=True)
    governed_cmds.add_ref_load(
        ref_cmds.add_parser("load", help="Load reference batches (API.APPLY_REFERENCE_CHANGE).")
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    # Never crash on a legacy console code page (e.g. cp1252) over an odd character.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    args = build_parser().parse_args(argv)
    if args.command == "version":
        print(f"bbc {__version__}")
        return 0
    if args.command == "test" and args.test_kind == "sql":
        return test_sql.run(args)
    if args.command == "sim" and args.sim_command == "init":
        return world_cmds.run_sim_init(args)
    if args.command == "deploy" and args.deploy_kind == "python":
        return deploy.run(args)
    if args.command == "policy" and args.policy_command == "check":
        return world_cmds.run_policy_check(args)
    if args.command == "policy" and args.policy_command == "draft":
        return governed_cmds.run_policy_draft(args)
    if args.command == "policy" and args.policy_command == "activate":
        return governed_cmds.run_policy_activate(args)
    if args.command == "ref" and args.ref_command == "load":
        return governed_cmds.run_ref_load(args)
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    sys.exit(main())
