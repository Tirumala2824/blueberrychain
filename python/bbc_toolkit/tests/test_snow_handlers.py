"""Behavior of the Snowflake procedure handlers, run against an in-memory fake session."""

import copy
import json
from pathlib import Path

import pytest
from bbc_toolkit import contracts, ledger, snow
from blueberrychain.sim import world as w
from fake_snowflake import FakeSnowflake

POLICY = json.loads(
    (Path(str(contracts.contracts_dir())).parent / "snowflake/seed/policy/v1.json").read_text(
        "utf-8"
    )
)
BATCHES = w.reference_batches(w.load_world())


# ---------------------------------------------------------------------- ledger
def test_appends_form_a_verifiable_chain():
    fake = FakeSnowflake()
    for i in range(3):
        snow.proc_ledger_append(
            fake, "TRANSITION", "CASE-00000001", "BBC_ENGINE_SVC", f"x#{i}", {"i": i}
        )
    entries = fake.ledger_entries()
    assert [e.seq for e in entries] == [1, 2, 3]
    assert (
        entries[0].prev_hash == ledger.GENESIS_HASH
        and entries[1].prev_hash == entries[0].entry_hash
    )
    assert ledger.verify_chain(entries).ok
    # the HEAD lock is taken before the HEAD is read, inside a transaction
    qs = [q for q, _ in fake.statements]
    assert (
        qs[0] == "BEGIN"
        and "last_seq = last_seq + 1" in qs[1]
        and qs[2].startswith("SELECT last_seq")
    )
    assert qs[-1] == "COMMIT"


def test_stored_payload_is_the_canonical_form():
    fake = FakeSnowflake()
    snow.proc_ledger_append(fake, "TRANSITION", "", "a", "r", {"b": 11.20, "a": [1]})
    stored = fake.entries[0]["payload"]
    assert stored == '{"a":[1],"b":11.2}'
    assert ledger.canonical_json(json.loads(stored)) == stored  # fixed point: re-hashing is stable
    assert fake.entries[0]["case_id"] is None


def test_canonical_hash_udf_matches_vectors():
    doc = json.loads(
        (Path(str(contracts.contracts_dir())) / "vectors/canonical_hash.json").read_text("utf-8")
    )
    for v in doc["vectors"]:
        assert snow.udf_canonical_hash(v["input"]) == v["sha256"]


# -------------------------------------------------------------- reference data
def test_reference_load_is_versioned_and_idempotent():
    fake = FakeSnowflake()
    parties = BATCHES["PARTY"]
    first = snow.proc_apply_reference_change(fake, "PARTY", parties, "initial load")
    assert first["status"] == "OK" and first["inserted"] == len(parties) and first["unchanged"] == 0

    again = snow.proc_apply_reference_change(fake, "PARTY", json.dumps(parties), "reload")
    assert again["inserted"] == 0 and again["unchanged"] == len(parties)
    assert again["ledger_seq"] is None  # a no-op load writes no ledger entry

    changed = copy.deepcopy(parties)
    changed[0]["name"] = "Blue Harvest Marketing Company"
    third = snow.proc_apply_reference_change(fake, "PARTY", changed, "rename")
    assert third["inserted"] == 1
    rows = [r for r in fake.ref["BBC_OS.REF.PARTIES"] if r["party_id"] == "PARTY-BHM"]
    assert [(r["version"], r["is_current"]) for r in rows] == [(1, False), (2, True)]

    entries = fake.ledger_entries()
    assert [e.entry_type for e in entries] == ["REFERENCE_CHANGED"] * 2
    assert entries[1].payload["changed_keys"] == [["PARTY-BHM"]]
    assert ledger.verify_chain(entries).ok


def test_composite_keys_and_json_columns():
    fake = FakeSnowflake()
    assert (
        snow.proc_apply_reference_change(fake, "CONTRACT", BATCHES["CONTRACT"], "load")["status"]
        == "OK"
    )
    terms = fake.ref["BBC_OS.REF.CONTRACTS"][0]["terms"]
    assert (
        isinstance(terms, str) and json.loads(terms)["liability_cap_usd"] == 50000
    )  # bound as JSON text
    prices = BATCHES["CHANNEL_PRICE"]
    assert snow.proc_apply_reference_change(fake, "CHANNEL_PRICE", prices, "load")[
        "inserted"
    ] == len(prices)
    assert snow.proc_apply_reference_change(fake, "CHANNEL_PRICE", prices, "load")[
        "unchanged"
    ] == len(prices)


@pytest.mark.parametrize(
    ("entity", "records", "reason", "expected"),
    [
        ("PARTY", [], "x", "non-empty array"),
        ("NOPE", [{}], "x", "unknown reference entity"),
        ("PARTY", [{"party_id": "P-1"}], "x", "records[0]"),
        ("PARTY", BATCHES["PARTY"][:1] * 2, "x", "duplicate key"),
        ("PARTY", BATCHES["PARTY"][:1], "  ", "REASON is required"),
    ],
)
def test_invalid_reference_batches_write_nothing(entity, records, reason, expected):
    fake = FakeSnowflake()
    result = snow.proc_apply_reference_change(fake, entity, records, reason)
    assert result["status"] == "INVALID" and any(expected in e for e in result["errors"])
    assert not fake.executed("BEGIN") and not fake.entries


def test_failure_rolls_back_and_propagates():
    fake = FakeSnowflake()
    fake.fail_on = "INSERT INTO BBC_OS.LEDGER.ENTRIES"
    with pytest.raises(RuntimeError):
        snow.proc_apply_reference_change(fake, "PARTY", BATCHES["PARTY"], "load")
    assert fake.executed("ROLLBACK") and not fake.executed("COMMIT")


# ---------------------------------------------------------------------- policy
def test_draft_then_activate_with_separation_of_duties():
    fake = FakeSnowflake(user="DURGAPRASAD17")
    drafted = snow.proc_draft_policy(fake, POLICY)
    assert drafted["status"] == "OK"
    assert fake.gov_rows["DECISION_RIGHTS"] == len(POLICY["decision_rights"])
    assert fake.gov_rows["PARAMETERS"] == len(POLICY["parameters"])

    same_user = snow.proc_activate_policy(fake, "1", "go live")
    assert same_user["status"] == "DENIED"

    fake.user = "BBC_DEMO_GOVADMIN"
    activated = snow.proc_activate_policy(fake, "1", "go live")
    assert activated["status"] == "OK" and activated["previous_version"] is None
    assert fake.policies["1"]["status"] == "ACTIVE"

    assert snow.proc_activate_policy(fake, "1", "again")["status"] == "INVALID"
    assert (
        snow.proc_draft_policy(fake, POLICY)["status"] == "INVALID"
    )  # active versions are immutable
    assert [e.entry_type for e in fake.ledger_entries()] == ["POLICY_DRAFTED", "POLICY_ACTIVATED"]


def test_tampered_draft_cannot_be_activated():
    fake = FakeSnowflake(user="DURGAPRASAD17")
    snow.proc_draft_policy(fake, POLICY)
    tampered = json.loads(fake.policies["1"]["document"])
    tampered["parameters"]["autonomy_ceiling"] = (
        4 if POLICY["parameters"]["autonomy_ceiling"] != 4 else 3
    )
    fake.policies["1"]["document"] = json.dumps(tampered)
    fake.user = "BBC_DEMO_GOVADMIN"
    result = snow.proc_activate_policy(fake, "1", "go live")
    assert result["status"] == "INVALID" and "content hash" in result["errors"][0]


def test_inconsistent_policy_is_never_drafted():
    broken = copy.deepcopy(POLICY)
    broken["router_rules"].pop()
    fake = FakeSnowflake()
    result = snow.proc_draft_policy(fake, broken)
    assert result["status"] == "INVALID" and not fake.executed("BEGIN")
