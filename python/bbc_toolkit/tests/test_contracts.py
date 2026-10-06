"""Every contract fixture: valid instances pass, invalid variants fail."""

import copy
import json
from pathlib import Path

import pytest
from bbc_toolkit import contracts

CONTRACTS = contracts.contracts_dir()
FIXTURES = CONTRACTS / "fixtures"
FIXTURE_FILES = sorted(p for p in FIXTURES.rglob("*.json"))


def _pointer_parts(pointer: str) -> list[str]:
    return [p.replace("~1", "/").replace("~0", "~") for p in pointer.lstrip("/").split("/")]


def _walk(doc, parts):
    for part in parts:
        doc = doc[int(part)] if isinstance(doc, list) else doc[part]
    return doc


def apply_patch(base, set_ops=None, delete_ops=None):
    doc = copy.deepcopy(base)
    for pointer, value in (set_ops or {}).items():
        *parent, last = _pointer_parts(pointer)
        target = _walk(doc, parent)
        if isinstance(target, list):
            target[int(last)] = value
        else:
            target[last] = value
    for pointer in delete_ops or []:
        *parent, last = _pointer_parts(pointer)
        target = _walk(doc, parent)
        del target[int(last) if isinstance(target, list) else last]
    return doc


def _cases():
    for path in FIXTURE_FILES:
        fixture = json.loads(path.read_text(encoding="utf-8"))
        rel = path.relative_to(FIXTURES).as_posix()
        for i, instance in enumerate(fixture["valid"]):
            yield pytest.param(fixture["schema"], instance, True, id=f"{rel}:valid[{i}]")
        for i, case in enumerate(fixture["invalid"]):
            base = fixture["valid"][case["base"]]
            instance = apply_patch(base, case.get("set"), case.get("delete"))
            yield pytest.param(
                fixture["schema"], instance, False, id=f"{rel}:invalid[{i}] {case['why']}"
            )


@pytest.mark.parametrize(("schema", "instance", "should_pass"), list(_cases()))
def test_fixture(schema, instance, should_pass):
    errors = contracts.validate(schema, instance)
    if should_pass:
        assert errors == [], errors
    else:
        assert errors, "expected the contract to reject this instance"


def test_every_schema_is_valid_and_has_fixtures():
    covered = {json.loads(p.read_text())["schema"] for p in FIXTURE_FILES}
    for name in contracts.schema_names():
        contracts.validator(name)  # raises if the schema itself is malformed
        if name != "common.json":
            assert name in covered, f"no fixtures for {name}"


def test_tool_registry_matches_schemas():
    registry = json.loads((CONTRACTS / "tool_registry.json").read_text(encoding="utf-8"))
    names = contracts.schema_names()
    tools = registry["tools"]
    assert len(tools) == 18
    assert len({t["id"] for t in tools}) == 18 and len({t["name"] for t in tools}) == 18
    for tool in tools:
        assert tool["input_schema"].removeprefix("schemas/") in names
        assert set(tool["allowed_agents"]) <= set(registry["agents"])
        assert tool["procedure"] == f"BBC_OS.AGENT.{tool['name']}"
    # only one tool may trigger a governed operational write, and only agents with a reason to
    mutations = [t for t in tools if t["behavior"] == "GOVERNED_MUTATION"]
    assert [t["name"] for t in mutations] == ["REQUEST_EVIDENCE"]
    assert "EVIDENCE_AUDITOR" not in mutations[0]["allowed_agents"]
    # the auditor reads artifacts and submits verdicts - nothing else
    auditor_tools = {t["name"] for t in tools if "EVIDENCE_AUDITOR" in t["allowed_agents"]}
    assert auditor_tools == {"GET_ARTIFACT_FOR_AUDIT", "SUBMIT_AUDIT_VERDICT"}


def test_validate_reports_json_pointer_paths():
    fixture = json.loads((FIXTURES / "option.json").read_text())
    bad = apply_patch(fixture["valid"][0], {"/outcome/operational/p_accept": 2})
    errors = contracts.validate("option.json", bad)
    assert any(e.path == "/outcome/operational/p_accept" for e in errors)


def test_unknown_schema_is_an_error():
    with pytest.raises(KeyError):
        contracts.validate("nope.json", {})


def test_contract_files_resolve_from_repo():
    assert (Path(CONTRACTS) / "schemas" / "common.json").is_file()
