import json
from pathlib import Path

import pytest
from bbc_toolkit import ledger
from blueberrychain import sqlgen
from blueberrychain.cli.test_sql import parse_tests

TESTS_DIR = sqlgen.ROOT / "snowflake" / "tests"


def test_hash_parity_file_is_current():
    assert sqlgen.HASH_PARITY.read_text(encoding="utf-8") == sqlgen.hash_parity_sql(), (
        "snowflake/tests/02_hash_parity.sql is stale: run `uv run python -m blueberrychain.sqlgen`"
    )


def test_hash_parity_literals_round_trip_to_the_vectors():
    # What Snowflake will PARSE_JSON must be the vector input, so the expected hash still applies.
    vectors = json.loads(sqlgen.VECTORS.read_text(encoding="utf-8"))["vectors"]
    for v in vectors:
        text = json.dumps(v["input"], ensure_ascii=True)
        literal = sqlgen._literal(text)
        unquoted = literal[1:-1].replace("''", "'").replace("\\\\", "\\")
        assert ledger.canonical_hash(json.loads(unquoted)) == v["sha256"]


@pytest.mark.parametrize("path", sorted(TESTS_DIR.glob("*.sql")), ids=lambda p: p.name)
def test_every_sql_test_file_parses(path: Path):
    tests = parse_tests(path.read_text(encoding="utf-8"), str(path))
    assert tests, f"{path.name} has no '-- test:' markers"
    assert len({t.name for t in tests}) == len(tests), f"{path.name} has duplicate test names"
