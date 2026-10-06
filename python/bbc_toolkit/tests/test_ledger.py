import dataclasses
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from bbc_toolkit import ledger


def test_numbers_canonicalize_regardless_of_type():
    same = [45301, 45301.0, Decimal("45301.00"), Decimal("45301")]
    assert {ledger.canonical_json(v) for v in same} == {"45301"}
    assert ledger.canonical_json(Decimal("11.20")) == ledger.canonical_json(11.2) == "11.2"
    assert ledger.canonical_json(0.1) == "0.1"
    assert ledger.canonical_json(1e-7) == "0.0000001"
    assert ledger.canonical_json(-0.0) == "0"


def test_objects_sorted_compact_and_ascii():
    value = {"b": [1, {"d": None, "c": True}], "a": "café"}
    assert ledger.canonical_json(value) == '{"a":"caf\\u00e9","b":[1,{"c":true,"d":null}]}'


def test_rejects_non_finite_and_non_string_keys():
    with pytest.raises(ValueError):
        ledger.canonical_json(float("nan"))
    with pytest.raises(ValueError):
        ledger.canonical_json(Decimal("Infinity"))
    with pytest.raises(TypeError):
        ledger.canonical_json({1: "x"})


def test_known_answer_vector():
    """Pinned vector: the Snowflake CANONICAL_HASH UDF must return this digest (task 2.8)."""
    payload = {
        "case_id": "CASE-00000017",
        "nrv_usd": Decimal("45301.00"),
        "lots": ["L-A"],
        "ok": True,
    }
    assert (
        ledger.canonical_json(payload)
        == '{"case_id":"CASE-00000017","lots":["L-A"],"nrv_usd":45301,"ok":true}'
    )
    assert ledger.canonical_hash(payload) == ledger.sha256_hex(ledger.canonical_json(payload))
    assert ledger.canonical_hash(payload) == KNOWN_DIGEST


# sha256 of the canonical string above, computed independently (coreutils sha256sum)
KNOWN_DIGEST = "cd443761ea144ab9d5ebda8ff910af7fa1d240e73096fd2f71cb8fde6d8b335b"


def test_iso_utc_normalizes_timezone():
    ist = timezone(timedelta(hours=5, minutes=30))
    moment = datetime(2026, 10, 6, 13, 25, 0, 123456, tzinfo=ist)
    assert ledger.iso_utc(moment) == "2026-10-06T07:55:00.123456Z"
    with pytest.raises(ValueError):
        ledger.iso_utc(datetime(2026, 10, 6))


def _chain(n=4):
    entries, prev = [], ledger.GENESIS_HASH
    start = datetime(2026, 10, 6, 7, 55, tzinfo=UTC)
    for seq in range(1, n + 1):
        entry = ledger.make_entry(
            seq=seq,
            ts=ledger.iso_utc(start + timedelta(seconds=seq)),
            entry_type="TRANSITION",
            case_id="CASE-00000017",
            actor="BBC_ENGINE_SVC",
            record_ref=f"DECISION.CASES:CASE-00000017#{seq}",
            payload={"seq_payload": seq, "state": "ASSESSED"},
            prev_hash=prev,
        )
        entries.append(entry)
        prev = entry.entry_hash
    return entries


def test_untampered_chain_verifies():
    result = ledger.verify_chain(_chain())
    assert result.ok and result.checked == 4


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        (
            lambda e: dataclasses.replace(e, payload={"seq_payload": e.seq, "state": "APPROVED"}),
            "PAYLOAD_HASH_MISMATCH",
        ),
        (lambda e: dataclasses.replace(e, actor="SOMEONE_ELSE"), "ENTRY_HASH_MISMATCH"),
        (lambda e: dataclasses.replace(e, prev_hash="f" * 64), "PREV_HASH_BREAK"),
    ],
)
def test_tampering_is_located_at_the_exact_seq(mutate, reason):
    entries = _chain()
    entries[2] = mutate(entries[2])
    result = ledger.verify_chain(entries)
    assert not result.ok and result.first_bad_seq == 3 and result.reason == reason


def test_deleted_entry_is_a_seq_gap():
    entries = _chain()
    del entries[1]
    result = ledger.verify_chain(entries)
    assert not result.ok and result.first_bad_seq == 2 and result.reason == "SEQ_GAP"


def test_recomputing_hashes_after_an_edit_still_breaks_the_next_link():
    """An attacker who re-hashes an edited entry still breaks every later prev_hash."""
    entries = _chain()
    edited = entries[1]
    forged = ledger.make_entry(
        seq=edited.seq,
        ts=edited.ts,
        entry_type=edited.entry_type,
        case_id=edited.case_id,
        actor=edited.actor,
        record_ref=edited.record_ref,
        payload={"forged": True},
        prev_hash=edited.prev_hash,
    )
    entries[1] = forged
    result = ledger.verify_chain(entries)
    assert not result.ok and result.first_bad_seq == 3 and result.reason == "PREV_HASH_BREAK"
