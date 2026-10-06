"""Simulator: thermal truth, device readings, faults, delivery to the webhook."""

import dataclasses
import io
import json
import urllib.error
from datetime import UTC, datetime, timedelta

import pytest
from bbc_engine import physics as ph
from bbc_toolkit import contracts
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as w
from blueberrychain.sim.clock import SimClock, floor_to, iso, utc
from blueberrychain.sim.thermal import approach

WORLD = w.load_world()
DEPART = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)
PRODUCTS = {p["product_id"]: p for p in WORLD["products"]}


def run(scenario="S-A", overrides=None, seed=None, **kw):
    trip = tp.scenario_trip(WORLD, scenario, DEPART, overrides, **kw)
    return tm.simulate(WORLD, trip, seed)


def series(result, device):
    return [m for m in result.messages if m["device_id"] == device]


def pulp_after(result, device, start):
    return [
        (utc(m["ts"]), m["values"]["pulp_c"])
        for m in series(result, device)
        if utc(m["ts"]) >= start
    ]


@pytest.fixture(scope="module")
def s_a():
    return run()


@pytest.fixture(scope="module")
def s_a_clean():
    return run(overrides={"reefer_compressor_failure": {"duration_h": 0.0001}})


def test_messages_honour_the_webhook_contract(s_a):
    for i in range(0, len(s_a.messages), 500):
        batch = {"source": "bbc-sim", "messages": s_a.messages[i : i + 500]}
        assert contracts.validate("connectors/iot_webhook.json", batch) == []


def test_simulation_is_deterministic_per_seed(s_a):
    again = run()
    assert again.messages == s_a.messages and again.truth == s_a.truth
    other = run(seed=7)
    assert other.messages != s_a.messages


def test_readings_sit_on_the_five_minute_grid(s_a):
    assert all(int(utc(m["ts"]).timestamp()) % 300 == 0 for m in s_a.messages)
    probe = series(s_a, "P-A1")
    assert len({m["ts"] for m in probe}) == len(probe)  # one reading per instant


def test_normal_trip_never_breaches_after_loading(s_a_clean):
    after = pulp_after(s_a_clean, "P-A1", DEPART)
    assert max(p for _, p in after) < 1.8  # no false excursions on a healthy trip
    reefer = series(s_a_clean, "RF-114")
    assert not any("COMPRESSOR_FAULT" in m["values"]["alarms"] for m in reefer)


def test_compressor_failure_warms_the_fruit_and_raises_alarms(s_a):
    fault = s_a.trip.faults[0]
    alarms = [
        utc(m["ts"]) for m in series(s_a, "RF-114") if "COMPRESSOR_FAULT" in m["values"]["alarms"]
    ]
    assert alarms[0] - fault.start <= timedelta(minutes=5) and alarms[-1] <= fault.end
    pulp = pulp_after(s_a, "P-A1", fault.start)
    first_breach = next(t for t, p in pulp if p > 1.8)
    assert timedelta(0) < first_breach - fault.start < timedelta(hours=1.5)
    assert max(p for _, p in pulp) > 3.0
    # The unit recovers, but a loaded trailer cannot pull warm fruit down quickly.
    at_arrival = pulp_after(s_a, "P-A1", s_a.trip.lots[0].segments[-2].end - timedelta(minutes=5))[
        0
    ][1]
    assert at_arrival > 2.0


def test_reefer_reports_position_along_its_lane(s_a):
    lats = [m["values"]["lat"] for m in series(s_a, "RF-114") if "lat" in m["values"]]
    assert lats and 36.4 < min(lats) and max(lats) < 40.8  # Kingsburg CA .. Salt Lake City UT


def test_estimator_differs_from_truth_but_stays_close(s_a):
    lot = s_a.trip.lots[0]
    model = ph.ShelfLifeModel.from_product(PRODUCTS[lot.product_id])
    readings = [
        ph.Reading(utc(m["ts"]), m["interval_s"], m["values"]["pulp_c"])
        for m in series(s_a, "P-A1")
    ]
    estimate = ph.lot_state(model, lot.harvest_at, readings).remaining_shelf_life_days
    truth = s_a.truth["lots"]["L-A"]["remaining_shelf_life_days"]
    assert estimate != truth and abs(estimate - truth) < 3.0


def test_probe_dropout_and_misplacement():
    base = tp.scenario_trip(WORLD, "S-A", DEPART)
    start = DEPART + timedelta(hours=3)
    faults = (
        *base.faults,
        tp.Fault("probe_dropout", "L-A", start, start + timedelta(hours=2), {}),
        tp.Fault("probe_misplaced", "L-A", params={"bias_c": -2.5}),
    )
    result = tm.simulate(WORLD, dataclasses.replace(base, faults=faults))
    stamps = {utc(m["ts"]) for m in series(result, "P-A1")}
    assert not any(start <= t < start + timedelta(hours=2) for t in stamps)
    normal = {m["ts"]: m["values"]["pulp_c"] for m in series(run(), "P-A1")}
    biased = [m["values"]["pulp_c"] - normal[m["ts"]] for m in series(result, "P-A1")]
    assert sum(biased) / len(biased) == pytest.approx(-2.5, abs=0.05)


def test_scenario_b_loads_warm_and_opens_doors_at_the_dc():
    result = run("S-B")
    lot = result.trip.lots[0]
    loading = next(s for s in lot.segments if s.kind == "DOCK")
    pulp_at_loading = pulp_after(result, "P-B1", loading.start)[0][1]
    assert pulp_at_loading > 3.0  # the paperwork will claim 1.0 C
    doors = [m for m in series(result, "RF-207") if m["values"]["door_open"]]
    assert doors and all(m["values"]["lat"] == pytest.approx(37.739) for m in doors)


def test_fault_overrides_are_checked():
    with pytest.raises(ValueError, match="no parameter"):
        tp.scenario_trip(WORLD, "S-A", DEPART, {"reefer_compressor_failure": {"colour": 1}})
    with pytest.raises(ValueError, match="unknown scenario"):
        tp.scenario_trip(WORLD, "S-Z", DEPART)


def test_window_and_clock_helpers(s_a):
    part = tm.window(s_a.messages, DEPART, DEPART + timedelta(minutes=10))
    assert {m["ts"] for m in part} == {"2026-10-06T10:00:00Z", "2026-10-06T10:05:00Z"}
    assert (
        iso(floor_to(datetime(2026, 10, 6, 10, 7, 31, tzinfo=UTC), 300)) == "2026-10-06T10:05:00Z"
    )
    assert approach(10.0, 0.0, 1.0, 3600) == pytest.approx(10.0 * 2.718281828**-1)
    slept = []
    clock = SimClock(DEPART, factor=60, sleep=slept.append, monotonic=lambda: 0.0)
    clock.wait_until(DEPART + timedelta(minutes=60))
    assert slept == [pytest.approx(60.0)]


def test_signature_matches_the_shared_vector():
    vectors = json.loads(
        (contracts.contracts_dir() / "vectors" / "webhook_signature.json").read_text()
    )
    for v in vectors["vectors"]:
        assert tm.signature(v["secret"], v["timestamp"], v["body"]) == v["signature"]


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_post_messages_signs_batches_and_retries_server_errors(s_a):
    calls = []

    def opener(request, timeout):
        calls.append(request)
        if len(calls) == 1:
            raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, io.BytesIO(b"{}"))
        body = json.loads(request.data)
        return FakeResponse(
            json.dumps({"accepted": len(body["messages"]), "rejected": []}).encode()
        )

    msgs = s_a.messages[:5]
    report = tm.post_messages(
        "http://x/v1/telemetry",
        "s3cret",
        msgs,
        batch_size=3,
        opener=opener,
        sleep=lambda _: None,
        now=lambda: 1_791_273_300,
    )
    assert (report.batches, report.sent, report.accepted) == (2, 5, 5)
    first = calls[1]
    ts = first.headers["X-bbc-timestamp"]
    assert first.headers["X-bbc-signature"] == tm.signature("s3cret", ts, first.data.decode())


def test_post_messages_stops_on_a_client_error(s_a):
    def opener(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url, 401, "no", {}, io.BytesIO(b'{"error": "signature mismatch"}')
        )

    with pytest.raises(RuntimeError, match="signature mismatch"):
        tm.post_messages("http://x", "s", s_a.messages[:1], opener=opener, sleep=lambda _: None)
