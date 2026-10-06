"""Language-neutral vectors in contracts/vectors: the Python implementation must reproduce them."""

import json

from bbc_toolkit import contracts, ledger, raw

VECTORS = contracts.contracts_dir() / "vectors"


def test_canonical_hash_vectors():
    doc = json.loads((VECTORS / "canonical_hash.json").read_text(encoding="utf-8"))
    for v in doc["vectors"]:
        assert ledger.canonical_json(v["input"]) == v["canonical"]
        assert ledger.canonical_hash(v["input"]) == v["sha256"]


def test_idempotency_vectors():
    doc = json.loads((VECTORS / "idempotency.json").read_text(encoding="utf-8"))
    for v in doc["telemetry"]:
        assert raw.telemetry_key(v["device_id"], v["reading_ts"]) == v["key"]
    for v in doc["business_events"]:
        key = raw.business_event_key(
            v["source_system"], v["entity_type"], v["external_id"], v["event_ts"]
        )
        assert key == v["key"]


def test_timestamps_normalize_across_offsets_and_precision():
    assert raw.normalize_ts("2026-10-06T13:25:00+05:30") == "2026-10-06T07:55:00.000000Z"
    assert raw.normalize_ts("2026-10-06T07:55:00.250Z") == "2026-10-06T07:55:00.250000Z"


def test_keys_differ_when_any_identity_field_differs():
    base = raw.business_event_key("SAP", "SALES_ORDER_ITEM", "SO-6001-10", "2026-10-05T18:00:00Z")
    assert base != raw.business_event_key(
        "SAP", "SALES_ORDER_ITEM", "SO-6001-20", "2026-10-05T18:00:00Z"
    )
    assert base != raw.business_event_key(
        "SAP", "SALES_ORDER_ITEM", "SO-6001-10", "2026-10-05T18:00:01Z"
    )
    assert base != raw.business_event_key(
        "TMS", "SALES_ORDER_ITEM", "SO-6001-10", "2026-10-05T18:00:00Z"
    )
