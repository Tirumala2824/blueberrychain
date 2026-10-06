"""`bbc` - the BlueberryChain OS command line."""

from __future__ import annotations

import argparse
import sys

from blueberrychain import __version__
from blueberrychain.cli import test_sql


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
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    sys.exit(main())
