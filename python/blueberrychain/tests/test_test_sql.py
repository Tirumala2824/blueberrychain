import argparse

import pytest
from blueberrychain.cli import test_sql
from blueberrychain.cli.main import main

SAMPLE = """\
-- header comment, ignored
-- test: schemas exist
SELECT 1 WHERE 1 = 0;

--   TEST:  two statements
SHOW ROLES;
SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
"""


def test_parse_tests_splits_on_markers_and_ignores_preamble():
    tests = test_sql.parse_tests(SAMPLE, file="x.sql")
    assert [t.name for t in tests] == ["schemas exist", "two statements"]
    assert tests[0].sql == "SELECT 1 WHERE 1 = 0;"
    assert tests[0].line == 2
    assert tests[1].sql.splitlines() == [
        "SHOW ROLES;",
        "SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));",
    ]


def test_parse_tests_rejects_unnamed_and_empty_tests():
    with pytest.raises(ValueError, match="without a name"):
        test_sql.parse_tests("-- test:\nSELECT 1;")
    with pytest.raises(ValueError, match="has no SQL"):
        test_sql.parse_tests("-- test: empty\n\n-- test: next\nSELECT 1;")


@pytest.mark.parametrize(
    "payload, expected",
    [
        ([], []),  # one statement, no rows
        ([{"A": 1}], [{"A": 1}]),  # one statement, rows
        ([[{"A": 1}], []], []),  # several statements, last empty
        ([[], [{"B": 2}]], [{"B": 2}]),  # several statements, last has rows
    ],
)
def test_last_result_set_handles_single_and_multi_statement_output(payload, expected):
    assert test_sql.last_result_set(payload) == expected


def test_last_result_set_rejects_unexpected_shapes():
    with pytest.raises(TypeError):
        test_sql.last_result_set({"A": 1})
    with pytest.raises(ValueError):
        test_sql.last_result_set([{"A": 1}, [1]])


def test_run_test_statuses():
    t = test_sql.SqlTest(file="f.sql", name="n", sql="SELECT 1", line=1)
    assert test_sql.run_test(t, lambda sql: []).status == "PASS"
    failed = test_sql.run_test(t, lambda sql: [{"VIOLATION": "x"}])
    assert failed.status == "FAIL" and failed.rows == [{"VIOLATION": "x"}]

    def boom(sql):
        raise RuntimeError("connection refused")

    errored = test_sql.run_test(t, boom)
    assert errored.status == "ERROR" and "connection refused" in errored.error


def _args(tmp_path, **overrides):
    defaults = {
        "paths": [str(tmp_path)],
        "connection": "c",
        "filter": "",
        "list": False,
        "max_rows": 5,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def test_run_exit_codes(tmp_path, capsys):
    (tmp_path / "a.sql").write_text("-- test: ok\nSELECT 1;\n-- test: bad\nSELECT 2;\n")

    def factory(_connection):
        return lambda sql: [] if "1" in sql else [{"ROW": 2}]

    assert test_sql.run(_args(tmp_path), executor_factory=factory) == 1
    out = capsys.readouterr().out
    assert "PASS  a.sql :: ok" in out and "FAIL  a.sql :: bad" in out and '{"ROW": 2}' in out

    assert test_sql.run(_args(tmp_path, filter="ok"), executor_factory=factory) == 0


def test_list_does_not_execute(tmp_path, capsys):
    (tmp_path / "a.sql").write_text("-- test: ok\nSELECT 1;\n")

    def factory(_connection):
        raise AssertionError("must not connect when listing")

    assert test_sql.run(_args(tmp_path, list=True), executor_factory=factory) == 0
    assert ":: ok" in capsys.readouterr().out


def test_no_tests_found_returns_2(tmp_path):
    assert test_sql.run(_args(tmp_path), executor_factory=lambda c: None) == 2


def test_missing_path_is_a_clean_error(tmp_path, capsys):
    args = _args(tmp_path, paths=[str(tmp_path / "nope")])
    assert test_sql.run(args, executor_factory=lambda c: None) == 2
    assert "no such test file or directory" in capsys.readouterr().out


def test_clean_snow_error_flattens_the_boxed_panel():
    panel = (
        "╭─ Error ──────────────╮\n"
        "│ 002003 (02000): SQL compilation error:   │\n"
        "│ Database 'BBC_OS' does not exist.        │\n"
        "╰──────────────────────╯\n"
    )
    assert test_sql.clean_snow_error(panel) == (
        "002003 (02000): SQL compilation error: Database 'BBC_OS' does not exist."
    )


def test_cli_version(capsys):
    assert main(["version"]) == 0
    assert capsys.readouterr().out.startswith("bbc ")
