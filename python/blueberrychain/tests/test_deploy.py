"""The Snowflake packaging works from the zip alone, exactly as a procedure IMPORT would."""

import json
import subprocess
import sys
import zipfile

from blueberrychain.cli import deploy

PROBE = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import bbc_toolkit
from bbc_toolkit import contracts, ledger
assert ".zip" in bbc_toolkit.__file__, bbc_toolkit.__file__
assert "_contracts" in str(contracts.contracts_dir())
fixture = json.loads(sys.argv[2])
assert contracts.validate("option.json", fixture) == []
root = contracts.contracts_dir().joinpath("vectors")
vectors = json.loads(root.joinpath("canonical_hash.json").read_text("utf-8"))
assert all(ledger.canonical_hash(v["input"]) == v["sha256"] for v in vectors["vectors"])
print("ok", len(contracts.schema_names()))
"""


def test_toolkit_zip_contains_code_and_contracts(tmp_path):
    path = deploy.build_zip("bbc_toolkit", tmp_path)
    names = zipfile.ZipFile(path).namelist()
    assert "bbc_toolkit/contracts.py" in names and "bbc_toolkit/ledger.py" in names
    assert "bbc_toolkit/_contracts/schemas/common.json" in names
    assert "bbc_toolkit/_contracts/schemas/tools/get_case_context.json" in names
    assert "bbc_toolkit/_contracts/vectors/idempotency.json" in names
    assert not any("__pycache__" in n or "/tests/" in n for n in names)


def test_zip_is_deterministic(tmp_path):
    a = deploy.build_zip("bbc_toolkit", tmp_path / "a").read_bytes()
    b = deploy.build_zip("bbc_toolkit", tmp_path / "b").read_bytes()
    assert a == b


def test_toolkit_imports_and_validates_from_the_zip_alone(tmp_path):
    path = deploy.build_zip("bbc_toolkit", tmp_path)
    fixture = json.loads(
        (deploy.contracts.contracts_dir() / "fixtures" / "option.json").read_text(encoding="utf-8")
    )["valid"][0]
    result = subprocess.run(
        [sys.executable, "-c", PROBE, str(path), json.dumps(fixture)],
        capture_output=True,
        text=True,
        cwd=tmp_path,
        check=False,
        env={"PATH": "", "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", "")},
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("ok ")
