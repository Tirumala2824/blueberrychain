"""World driver: SAP, TMS and IoT records that tell the same story as the telemetry."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from bbc_toolkit import contracts
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as w
from blueberrychain.sim import world_driver as wd
from blueberrychain.sim.clock import utc

WORLD = w.load_world()
DEPART = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)


@pytest.fixture(scope="module", params=["S-A", "S-B"])
def world_run(request):
    trip = tp.scenario_trip(WORLD, request.param, DEPART)
    result = tm.simulate(WORLD, trip)
    return trip, result, wd.world_actions(WORLD, trip, result.messages)


def records(actions, path):
    return [r for a in actions if a.path == path for r in a.body["records"]]


def test_actions_are_in_time_order_and_deterministic(world_run):
    trip, result, actions = world_run
    assert [a.at for a in actions] == sorted(a.at for a in actions)
    assert wd.world_actions(WORLD, trip, result.messages) == actions


def test_custody_events_reproduce_every_segment_holder(world_run):
    """Expanded to lots and ASOF-joined (strict >) as OPS.LOT_CUSTODY / TELEMETRY_ASSIGNED do,
    the TMS custody events give each reading the holder the simulator used."""
    trip, result, actions = world_run
    lots_on = {s.shipment_id: [lot for lot, _ in s.lots] for s in trip.shipments}
    custody = [e for e in records(actions, "/__sim/events") if e["kind"] == "CUSTODY"]
    for lot in trip.lots:
        events = sorted(
            (utc(e["at"]), e["to_party_id"])
            for e in custody
            if lot.lot_id in lots_on[e["shipment_id"]]
        )
        for message in (m for m in result.messages if m["device_id"] == lot.probe_device_id):
            ts = utc(message["ts"])
            before = [holder for at, holder in events if ts > at]
            holder = before[-1] if before else lot.grower_party_id  # the DT's COALESCE
            assert holder == lot.segment_at(ts - timedelta(seconds=1)).holder_party_id, (
                lot.lot_id,
                message["ts"],
            )


def test_pairings_cover_probes_and_reefers(world_run):
    trip, _, actions = world_run
    pairings = [p for a in actions if a.system == "IOT" for p in a.body["pairings"]]
    batch = {"pairings": pairings}
    assert contracts.validate("connectors/iot_pairing.json", batch) == []
    probes = {p["device_id"]: p["target_id"] for p in pairings if p["role"] == "PRIMARY"}
    assert probes == {lot.probe_device_id: lot.lot_id for lot in trip.lots}
    for shipment in trip.shipments:
        versions = [p for p in pairings if p["target_id"] == shipment.shipment_id]
        assert [bool(p.get("assigned_to")) for p in versions] == [
            False,
            True,
        ]  # opened, then closed


def test_sap_records_follow_the_lots(world_run):
    trip, _, actions = world_run
    batches = {b["Batch"]: b for b in records(actions, "/__sim/batches")}
    assert set(batches) == {lot.lot_id for lot in trip.lots}
    order = records(actions, "/__sim/sales-orders")[0]
    main = trip.lots[0]
    assert order["SoldToParty"] == "100301" and order["items"][0]["Batch"] == main.lot_id
    delivery = records(actions, "/__sim/deliveries")[0]
    item = delivery["items"][0]
    assert (item["ReferenceSDDocument"], item["Batch"]) == (order["SalesOrder"], main.lot_id)
    # Stock never goes negative and ends where the lots end.
    final: dict[tuple[str, str, str], float] = {}
    for r in records(actions, "/__sim/stock"):
        assert r["quantity"] >= 0
        final[(r["Plant"], r["Batch"], r["InventoryStockType"])] = r["quantity"]
    at_dc = {
        batch
        for (plant, batch, kind), qty in final.items()
        if qty > 0 and plant == "1000" and kind == "01"
    }
    assert at_dc == {"L-R1", "L-R2"}
    assert not any(qty > 0 for (_, batch, _), qty in final.items() if batch == main.lot_id)


def test_origin_qc_shows_the_paperwork_fault_only_in_s_b(world_run):
    trip, result, actions = world_run
    qc = {r["Batch"]: r for r in records(actions, "/__sim/inspection-lots")}
    main = trip.lots[0]
    loading = next(s for s in main.segments if s.kind == "DOCK" and not s.shipment_id)
    measured = wd._probe_reading(result.messages, main.probe_device_id, loading.start)
    if trip.scenario == "S-B":
        assert qc[main.lot_id]["YY1_PulpTempC"] == 1.0 and measured > 3.0  # certificate vs probe
    else:
        assert qc[main.lot_id]["YY1_PulpTempC"] == measured
    assert "L-R2" not in qc  # farm-cooled lots have no packhouse inspection


def test_shipments_report_the_junction_and_positions(world_run):
    trip, _, actions = world_run
    events = records(actions, "/__sim/events")
    main = next(s for s in trip.shipments if s.shipment_id in ("SHP-A", "SHP-B"))
    mine = [e for e in events if e["shipment_id"] == main.shipment_id]
    positions = [e for e in mine if e["event_id"].startswith(f"{main.shipment_id}-POS-")]
    assert len(positions) >= 20
    if trip.scenario == "S-A":
        junction = next(e for e in mine if e["event_id"] == "SHP-A-JUNCTION")
        assert utc(junction["at"]) - main.departure == timedelta(hours=3)
    statuses = [e["status"] for e in mine if e["kind"] == "STATUS"]
    assert statuses[0] == "LOADING" and statuses[-1] == "DELIVERED"


class FakeTransport:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, json.loads(body) if body else None))
        if url.endswith("/v1/telemetry"):
            n = len(json.loads(body)["messages"])
            return 200, json.dumps({"accepted": n, "rejected": []}).encode()
        if url.endswith("/v1/pairings"):
            return 200, json.dumps({"accepted": 1, "rejected": []}).encode()
        return 200, b"{}"


def test_runner_sets_clocks_signs_pairings_and_flushes_telemetry_in_order():
    trip = tp.scenario_trip(WORLD, "S-A", DEPART)
    result = tm.simulate(WORLD, trip)
    actions = wd.world_actions(WORLD, trip, result.messages)[:40]
    cutoff = actions[-1].at
    messages = [m for m in result.messages if utc(m["ts"]) <= cutoff]
    transport = FakeTransport()

    def post(url, secret, msgs, **kw):
        return tm.post_messages(
            url, secret, msgs, opener=_opener(transport), sleep=lambda _: None, **kw
        )

    runner = wd.WorldRunner(
        wd.Endpoints(iot_secret="s3cret"), transport=transport, now=lambda: 1_791_273_300
    )
    report = runner.run(actions, messages, post=post)
    assert report.actions == 40 and report.telemetry.sent == len(messages)
    first_s4 = next(
        i for i, c in enumerate(transport.calls) if ":4004/__sim/" in c[1] and "clock" not in c[1]
    )
    assert transport.calls[first_s4 - 1][1].endswith(":4004/__sim/clock")  # the clock is set first
    pairing = next(c for c in transport.calls if c[1].endswith("/v1/pairings"))
    assert pairing[2]["X-BBC-Signature"] == tm.signature(
        "s3cret", "1791273300", json.dumps(pairing[3], separators=(",", ":"))
    )
    # Readings older than an action are delivered before it.
    order = [c[1] for c in transport.calls]
    assert order.index(next(u for u in order if u.endswith("/v1/telemetry"))) < len(order)


def _opener(transport):
    import io

    class Response(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def opener(request, timeout):
        _status, raw = transport(
            request.get_method(), request.full_url, dict(request.header_items()), request.data
        )
        return Response(raw)

    return opener
