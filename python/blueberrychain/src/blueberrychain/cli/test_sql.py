"""SQL assertion test runner behind `bbc test sql`.

Convention for files in ``snowflake/tests/*.sql``::

    -- test: <name>
    <one or more SQL statements>

A test passes when its LAST statement returns zero rows; any rows returned
are the violations and are printed. Text before the first marker is ignored,
so files can start with a header comment. Tests run through the ``snow`` CLI
against a named connection, read-only by convention.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

# "-- test: name", tolerant of case and spacing
MARKER = re.compile(r"^\s*--\s*test\s*:(.*)$", re.IGNORECASE)
DEFAULT_PATHS = ["snowflake/tests"]
DEFAULT_CONNECTION = "pndvhar-pt70809"

Rows = list[dict[str, Any]]
Executor = Callable[[str], Rows]


@dataclasses.dataclass(frozen=True)
class SqlTest:
    file: str
    name: str
    sql: str
    line: int


@dataclasses.dataclass(frozen=True)
class SqlTestResult:
    test: SqlTest
    status: str  # PASS | FAIL | ERROR
    rows: Rows
    seconds: float
    error: str | None = None


def parse_tests(text: str, file: str = "<string>") -> list[SqlTest]:
    """Split a test file into named tests on ``-- test:`` markers."""
    tests: list[SqlTest] = []
    name: str | None = None
    start = 0
    body: list[str] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        marker = MARKER.match(line)
        if marker:
            if name is not None:
                tests.append(_make_test(file, name, body, start))
            name = marker.group(1).strip()
            if not name:
                raise ValueError(f"{file}:{lineno}: test marker without a name")
            start, body = lineno, []
        elif name is not None:
            body.append(line)
    if name is not None:
        tests.append(_make_test(file, name, body, start))
    return tests


def _make_test(file: str, name: str, body: list[str], line: int) -> SqlTest:
    sql = "\n".join(body).strip()
    if not sql:
        raise ValueError(f"{file}:{line}: test '{name}' has no SQL")
    return SqlTest(file=file, name=name, sql=sql, line=line)


def last_result_set(payload: Any) -> Rows:
    """Return the rows of the last statement from ``snow sql --format json`` output.

    One statement yields a list of row objects; several statements yield a
    list of row lists.
    """
    if not isinstance(payload, list):
        raise TypeError("unexpected snow output: expected a JSON array")
    if payload and all(isinstance(item, list) for item in payload):
        return payload[-1]
    if all(isinstance(item, dict) for item in payload):
        return payload
    raise ValueError("unexpected snow output: mixed result shapes")


def snow_executor(connection: str, timeout_s: int = 300) -> Executor:
    exe = shutil.which("snow")
    if exe is None:
        raise RuntimeError("snow CLI not found on PATH")
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}

    def execute(sql: str) -> Rows:
        proc = subprocess.run(
            [exe, "sql", "-c", connection, "--format", "json", "-q", sql],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=timeout_s,
            check=False,
        )
        if proc.returncode != 0:
            message = clean_snow_error(proc.stderr or proc.stdout)
            raise RuntimeError(message or f"snow exited {proc.returncode}")
        return last_result_set(json.loads(proc.stdout))

    return execute


_BOX_CHARS = str.maketrans("", "", "╭╮╰╯│─┌┐└┘├┤")


def clean_snow_error(text: str) -> str:
    """Flatten snow's boxed error panel into one plain line."""
    lines = [" ".join(line.translate(_BOX_CHARS).split()) for line in text.splitlines()]
    lines = [line for line in lines if line and line.lower() != "error"]
    return " ".join(lines)


def run_test(test: SqlTest, execute: Executor) -> SqlTestResult:
    started = time.perf_counter()
    try:
        rows = execute(test.sql)
    except Exception as exc:  # noqa: BLE001 - any failure is reported as ERROR, never swallowed
        return SqlTestResult(test, "ERROR", [], time.perf_counter() - started, str(exc))
    status = "PASS" if not rows else "FAIL"
    return SqlTestResult(test, status, rows, time.perf_counter() - started)


def collect_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(path.glob("*.sql")))
        elif path.is_file():
            files.append(path)
        else:
            raise FileNotFoundError(f"no such test file or directory: {raw}")
    return files


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "paths", nargs="*", default=DEFAULT_PATHS, help="Test files or directories."
    )
    parser.add_argument(
        "-c",
        "--connection",
        default=os.environ.get("BBC_CONNECTION", DEFAULT_CONNECTION),
        help="snow CLI connection name (default: $BBC_CONNECTION).",
    )
    parser.add_argument(
        "-k", "--filter", default="", help="Only run tests whose name contains this."
    )
    parser.add_argument("--list", action="store_true", help="List tests without running them.")
    parser.add_argument(
        "--max-rows", type=int, default=5, help="Violation rows to print per failure."
    )


def run(
    args: argparse.Namespace, executor_factory: Callable[[str], Executor] = snow_executor
) -> int:
    tests: list[SqlTest] = []
    try:
        for file in collect_files(args.paths):
            tests.extend(parse_tests(file.read_text(encoding="utf-8"), file=file.as_posix()))
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}")
        return 2
    tests = [t for t in tests if args.filter.lower() in t.name.lower()]
    if not tests:
        print("no SQL tests found")
        return 2

    if args.list:
        for t in tests:
            print(f"{t.file}:{t.line} :: {t.name}")
        return 0

    execute = executor_factory(args.connection)
    counts = {"PASS": 0, "FAIL": 0, "ERROR": 0}
    for test in tests:
        result = run_test(test, execute)
        counts[result.status] += 1
        print(f"{result.status:<5} {Path(test.file).name} :: {test.name} ({result.seconds:.1f}s)")
        if result.status == "FAIL":
            for row in result.rows[: args.max_rows]:
                print(f"        {json.dumps(row, default=str)}")
            if len(result.rows) > args.max_rows:
                print(f"        ... {len(result.rows) - args.max_rows} more")
        elif result.status == "ERROR":
            print(f"        {result.error}")

    print(f"\n{counts['PASS']} passed, {counts['FAIL']} failed, {counts['ERROR']} errors")
    return 0 if counts["FAIL"] == counts["ERROR"] == 0 else 1
