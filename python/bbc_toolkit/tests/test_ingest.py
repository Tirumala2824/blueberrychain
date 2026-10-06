"""API.INGEST_BATCH / API.GET_CONNECTOR_STATE handlers against the fake session."""

import copy
import json

import pytest
from bbc_toolkit import ingest, raw, snow
from fake_snowflake import FakeSnowflake


def reading(ts: str, pulp: float = 0.8, device: str = "P-A1", connector: str = "iot-webhook"):
    return {
        "device_id": device,
        "reading_ts": ts,
        "interval_s": 300,
        "idempotency_key": raw.telemetry_key(device, ts),
        "connector_id": connector,
        "provenance": "SIMULATION_LIVE",
        "readings": {"pulp_c": pulp},
    }


def event(external_id: str, ts: str = "2026-10-06T06:00:00Z"):
    return {
        "source_system": "SAP",
        "entity_type": "LOT",
        "external_id": external_id,
        "event_ts": ts,
        "idempotency_key": raw.business_event_key("SAP", "LOT", external_id, ts),
        "connector_id": "sap-s4",
        "payload": {
            "lot_id": external_id,
            "product_id": "BB-EMERALD-ORG-12x6",
            "grower_party_id": "PARTY-EMERALD-RIDGE",
            "harvest_site_id": "SITE-RANCH14-B7",
            "harvest_at": "2026-10-06T05:30:00Z",
            "kg": 4200,
            "organic": True,
        },
    }


BATCH = [reading(f"2026-10-06T08:{m:02d}:00Z") for m in (0, 5, 10)]


def test_batch_lands_once_and_replays_insert_nothing():
    fake = FakeSnowflake()
    first = snow.proc_ingest_batch(fake, "TELEMETRY", "iot-webhook", BATCH, "", "")
    assert first["status"] == "OK"
    assert (first["received"], first["inserted"], first["duplicates"], first["rejected"]) == (
        3,
        3,
        0,
        0,
    )
    again = snow.proc_ingest_batch(fake, "TELEMETRY", "iot-webhook", json.dumps(BATCH), "", "")
    assert (again["inserted"], again["duplicates"]) == (0, 3)
    assert len(fake.raw["TELEMETRY"]) == 3
    stored = next(iter(fake.raw["TELEMETRY"].values()))
    assert stored["reading_ts"] == "2026-10-06 08:00:00.000000 +00:00"
    assert stored["connector_id"] == "iot-webhook" and stored["provenance"] == "SIMULATION_LIVE"


def test_duplicates_inside_one_batch_count_once():
    fake = FakeSnowflake()
    # Same instant written with a different offset: the same reading, so the same key.
    twin = reading("2026-10-06T13:30:00+05:30")
    out = snow.proc_ingest_batch(
        fake, "TELEMETRY", "iot-webhook", [BATCH[0], twin, BATCH[0]], "", ""
    )
    assert (out["inserted"], out["duplicates"]) == (1, 2)


def test_bad_rows_are_dead_lettered_and_good_rows_still_land():
    fake = FakeSnowflake()
    forged = copy.deepcopy(BATCH[1])
    forged["idempotency_key"] = "0" * 64
    hot = reading("2026-10-06T08:20:00Z", pulp=99)  # outside the contract's range
    stranger = reading("2026-10-06T08:25:00Z", connector="sap-s4")
    out = snow.proc_ingest_batch(
        fake, "TELEMETRY", "iot-webhook", [BATCH[0], forged, hot, stranger], "", ""
    )
    assert out["status"] == "PARTIAL"
    assert (out["inserted"], out["rejected"]) == (1, 3)
    assert [r["index"] for r in out["rejects"]] == [1, 2, 3]
    assert "expected " + BATCH[1]["idempotency_key"] in out["rejects"][0]["errors"][0]
    assert out["rejects"][1]["errors"][0].startswith("/readings/pulp_c")
    assert "does not match" in out["rejects"][2]["errors"][0]
    assert [e["row"]["reading_ts"] for e in fake.ingest_errors] == [
        "2026-10-06T08:05:00Z",
        "2026-10-06T08:20:00Z",
        "2026-10-06T08:25:00Z",
    ]
    assert all(e["target"] == "TELEMETRY" for e in fake.ingest_errors)


def test_business_events_advance_the_cursor_in_the_same_call():
    fake = FakeSnowflake()
    out = snow.proc_ingest_batch(
        fake,
        "BUSINESS_EVENTS",
        "sap-s4",
        [event("L-A"), event("L-B")],
        "lots",
        "2026-10-06T06:00:00Z",
    )
    assert out["status"] == "OK" and out["inserted"] == 2
    assert out["cursor_value"] == "2026-10-06T06:00:00Z"
    stored = fake.raw["BUSINESS_EVENTS"]
    assert {r["external_id"] for r in stored.values()} == {"L-A", "L-B"}
    state = snow.proc_get_connector_state(fake, "sap-s4")
    assert state["streams"]["lots"]["cursor_value"] == "2026-10-06T06:00:00Z"
    # A new version of the same lot is a new row; the cursor moves on.
    out = snow.proc_ingest_batch(
        fake, "BUSINESS_EVENTS", "sap-s4", [event("L-A", "2026-10-06T07:00:00Z")], "lots", "c2"
    )
    assert out["inserted"] == 1 and fake.cursors[("sap-s4", "lots")] == "c2"


def test_the_payload_contract_follows_the_entity_type():
    bad = event("L-C")
    del bad["payload"]["kg"]
    out = snow.proc_ingest_batch(FakeSnowflake(), "BUSINESS_EVENTS", "sap-s4", [bad], "", "")
    assert out["rejected"] == 1 and "kg" in out["rejects"][0]["errors"][0]


@pytest.mark.parametrize(
    ("target", "connector", "rows", "stream", "expected"),
    [
        ("OPS", "iot-webhook", BATCH, "", "TARGET"),
        ("TELEMETRY", "IOT", BATCH, "", "CONNECTOR_ID"),
        ("TELEMETRY", "iot-webhook", [], "", "non-empty"),
        ("TELEMETRY", "iot-webhook", BATCH * 2000, "", "limit"),
        ("TELEMETRY", "iot-webhook", BATCH, "bad stream!", "STREAM"),
    ],
)
def test_invalid_batches_write_nothing(target, connector, rows, stream, expected):
    fake = FakeSnowflake()
    out = snow.proc_ingest_batch(fake, target, connector, rows, stream, "")
    assert out["status"] == "INVALID" and any(expected in e for e in out["errors"])
    assert fake.statements == []


def test_failure_rolls_back_and_propagates():
    fake = FakeSnowflake()
    fake.fail_on = "MERGE INTO BBC_OS.RAW.CONNECTOR_STATE"
    with pytest.raises(RuntimeError):
        snow.proc_ingest_batch(fake, "BUSINESS_EVENTS", "sap-s4", [event("L-A")], "lots", "c1")
    assert [s[0] for s in fake.statements][-1] == "ROLLBACK"


def test_sql_ts_is_utc_with_microseconds():
    assert ingest.sql_ts("2026-10-06T13:25:00.5+05:30") == "2026-10-06 07:55:00.500000 +00:00"
