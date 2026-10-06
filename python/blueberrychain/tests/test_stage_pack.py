"""The Snowflake pack builder (bbc_toolkit.stages.assemble_pack) against the reference
(blueberrychain.sim.assess): fed the same front-door facts, the engine must reach the same
result - same options, same eliminations, same rule decision or escalation."""

import json
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from pathlib import Path

import pytest
from bbc_engine import physics as ph
from bbc_engine.context import EngineContext
from bbc_engine.engine import evaluate
from bbc_toolkit import contracts, stages
from blueberrychain.sim import assess
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as w
from blueberrychain.sim.clock import iso, utc

WORLD = w.load_world()
POLICY = json.loads(
    (Path(__file__).resolve().parents[3] / "snowflake" / "seed" / "policy" / "v2.json").read_text(
        encoding="utf-8"
    )
)
CTX = EngineContext.from_world(WORLD, POLICY)
DEPART = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)


def governed_inputs(trip, messages, as_of):
    """What stage_procs.load_pack_inputs reads from OPS / REF / the semantic view, built here
    from the same simulated front-door data."""
    lot = trip.lots[0]
    shipment = next(s for s in trip.shipments if any(x == lot.lot_id for x, _ in s.lots))
    order = next(o for o in trip.orders if o.lot_id == lot.lot_id)
    product = next(p for p in WORLD["products"] if p["product_id"] == lot.product_id)
    model = ph.ShelfLifeModel.from_product(product)
    grower = next(
        c["terms"]
        for c in WORLD["contracts"]
        if c["party_id"] == lot.grower_party_id and c["contract_type"] == "GROWER_SUPPLY"
    )

    def readings_of(plan):
        out = []
        for m in messages:
            if m["device_id"] == plan.probe_device_id and utc(m["ts"]) <= as_of:
                seg = plan.segment_at(utc(m["ts"]) - timedelta(seconds=1))
                out.append(
                    {
                        "reading_ts": m["ts"],
                        "interval_s": m["interval_s"],
                        "pulp_c": m["values"]["pulp_c"],
                        "holder": seg.holder_party_id if seg else None,
                    }
                )
        return out

    readings = readings_of(lot)
    physics = [
        ph.Reading(utc(r["reading_ts"]), r["interval_s"], r["pulp_c"], r["holder"])
        for r in readings
    ]
    state = ph.lot_state(model, lot.harvest_at, physics)
    exposure = ph.custody_exposure(
        physics,
        model,
        attributable_after=lot.harvest_at + timedelta(hours=grower["precool_max_hours"]),
    )
    reefer = [
        m
        for m in messages
        if m["device_id"] == trip.trucks[shipment.truck_id] and utc(m["ts"]) <= as_of
    ]
    timeline, holder = [], None
    for seg in lot.segments:
        if seg.holder_party_id != holder:
            timeline.append(
                {"party_id": seg.holder_party_id, "site_id": seg.site_id, "from_at": iso(seg.start)}
            )
            holder = seg.holder_party_id
    for prev, nxt in pairwise(timeline):
        prev["to_at"] = nxt["from_at"]
    inventory = []
    for other in trip.lots[1:]:
        seg = other.segment_at(as_of)
        if seg is None or seg.kind != "DC_COLD":
            continue
        other_model = ph.ShelfLifeModel.from_product(
            next(p for p in WORLD["products"] if p["product_id"] == other.product_id)
        )
        other_readings = [
            ph.Reading(utc(r["reading_ts"]), r["interval_s"], r["pulp_c"], r["holder"])
            for r in readings_of(other)
        ]
        inventory.append(
            {
                "lot_id": other.lot_id,
                "site_id": seg.site_id,
                "product_id": other.product_id,
                "atp_kg": other.kg,
                "remaining_shelf_life_days": ph.lot_state(
                    other_model, other.harvest_at, other_readings
                ).remaining_shelf_life_days,
                "snapshot_at": iso(as_of - timedelta(minutes=as_of.minute % 15)),
            }
        )
    status = (
        "LOADING"
        if as_of < shipment.departure
        else "DELIVERED"
        if as_of >= shipment.arrival
        else "IN_TRANSIT"
    )
    return {
        "case_id": "CASE-00000001",
        "pack_id": "PACK-00000001",
        "revision": 1,
        "decision_point": "D1",
        "as_of": iso(as_of),
        "sealed_at": iso(as_of + timedelta(seconds=12)),
        "param_versions": {
            "policy": str(POLICY["policy_version"]),
            "semantic": "2",
            "engine": "0.1.0",
        },
        "policy": POLICY,
        "ref": {
            "parties": WORLD["parties"],
            "sites": WORLD["sites"],
            "lanes": WORLD["lanes"],
            "products": WORLD["products"],
            "specs": WORLD["customer_specs"],
            "contracts": WORLD["contracts"],
            "prices": WORLD["channel_prices"],
        },
        "shipment": {
            "shipment_id": shipment.shipment_id,
            "carrier_party_id": shipment.carrier_party_id,
            "reefer_device_id": trip.trucks[shipment.truck_id],
            "origin_site_id": shipment.origin_site_id,
            "destination_site_id": shipment.destination_site_id,
            "bol_setpoint_c": shipment.bol_setpoint_c,
            "status": status,
            "departed_at": iso(shipment.departure),
            "eta_at": iso(shipment.arrival),
            "planned_arrival_at": iso(shipment.arrival),
        },
        "reefer": {"reading_ts": reefer[-1]["ts"], **reefer[-1]["values"]} if reefer else None,
        "lots": [
            {
                "lot_id": lot.lot_id,
                "product_id": lot.product_id,
                "kg": lot.kg,
                "grower_party_id": lot.grower_party_id,
                "harvest_at": iso(lot.harvest_at),
                "probe_device_id": lot.probe_device_id,
                "readings": readings,
                "values": {
                    "as_of": iso(state.as_of),
                    "remaining_shelf_life_days": state.remaining_shelf_life_days,
                    "monitoring_coverage_pct": state.monitoring_coverage_pct,
                    "temperature_compliance_pct": state.temperature_compliance_pct,
                },
                "exposures": [
                    {
                        "holder_party_id": e.holder,
                        "excess_life_share": e.excess_life_share,
                        "thermal_exposure_deg_h": e.degree_min_above / 60,
                        "breach_min": e.breach_min,
                    }
                    for e in exposure.values()
                ],
            }
        ],
        "order_lines": [
            {
                "order_line_id": f"SO-{order.sales_order}-{order.item}",
                "customer_party_id": order.customer_party_id,
                "product_id": order.product_id,
                "kg": order.kg,
                "price_usd_per_kg": order.price_usd_per_kg,
                "requested_delivery_at": iso(order.requested_delivery_at),
                "ship_to_site_id": order.ship_to_site_id,
                "status": "SHIPPED",
                "assigned_lot_id": lot.lot_id,
            }
        ],
        "inventory": inventory,
        "timeline": timeline,
    }


def both(scenario, overrides=None):
    trip = tp.scenario_trip(WORLD, scenario, DEPART, overrides)
    result = tm.simulate(WORLD, trip)
    as_of = assess.opened_at(WORLD, POLICY, trip, result.messages, DEPART)
    reference = assess.assess(WORLD, POLICY, trip, result.messages, as_of)
    governed = stages.assemble_pack(governed_inputs(trip, result.messages, as_of))
    return reference, governed


def summary(pack):
    ev = evaluate(pack, CTX, option_id_start=1)
    return {
        "decision": ev.key_of(ev.decision["option_id"]) if ev.decision else None,
        "escalation": ev.escalation_reasons,
        "feasible": sorted(ev.key_of(o["option_id"]) for o in ev.options if o["feasible"]),
    }


@pytest.mark.parametrize(
    ("scenario", "overrides"),
    [
        ("S-A", None),
        ("S-A", {"reefer_compressor_failure": {"ambient_c": 18}}),
        ("S-A", {"reefer_compressor_failure": {"ambient_c": 35}}),
        ("S-B", None),
    ],
)
def test_governed_pack_drives_the_engine_like_the_reference(scenario, overrides):
    reference, governed = both(scenario, overrides)
    assert contracts.validate("evidence_pack.json", governed) == []
    assert summary(governed) == summary(reference)


def test_governed_pack_carries_the_same_facts():
    reference, governed = both("S-A", {"reefer_compressor_failure": {"ambient_c": 18}})
    for key in ("candidate_destinations", "inspection_sites", "deadline_inputs"):
        assert governed[key] == reference[key]
    assert governed["lots"][0]["values"] == reference["lots"][0]["values"]
    assert governed["lots"][0]["custody_exposure"] == reference["lots"][0]["custody_exposure"]
    assert governed["custody_timeline"] == reference["custody_timeline"]
    assert governed["affected_order_lines"] == reference["affected_order_lines"]


def test_rule_finding_is_contract_valid_and_names_no_one():
    _, governed = both("S-A")
    finding = stages.rule_finding(governed)
    assert contracts.validate("finding.json", finding) == []
    assert finding["responsible_parties"] == [] and finding["sufficiency"] == "INSUFFICIENT"


def test_the_rule_decided_reroute_needs_sales_and_quality():
    _, governed = both("S-A", {"reefer_compressor_failure": {"ambient_c": 18}})
    ev = evaluate(governed, CTX, option_id_start=1)
    option = next(o for o in ev.options if o["option_id"] == ev.decision["option_id"])
    actions = stages.bundle_actions(option, governed)
    assert [a["action_type"] for a in actions] == [
        "CLAIM_NOTICE",
        "REROUTE",
        "REPLACEMENT_ALLOCATION",
    ]
    assert [a["step_seq"] for a in actions] == [1, 2, 3]
    default = next(o for o in ev.options if o["is_default"])
    var = (
        sum(lot["planned_value_usd"] for lot in governed["lots"])
        - default["outcome"]["financial"]["expected_nrv_usd"]
    )
    verdict = stages.evaluate_bundle(
        option, governed, POLICY, decider_kind="RULE", value_at_risk_usd=var
    )
    assert verdict["outcome"] == "APPROVE"
    assert set(verdict["required_roles"]) == {"BBC_SALES_MGR", "BBC_QUALITY_MGR"}
    assert {a["action_type"]: a["outcome"] for a in verdict["actions"]}["CLAIM_NOTICE"] == "AUTO"


def test_every_waiting_state_names_who_acts():
    assert set(stages.ADVANCE_STEPS).isdisjoint(stages.WAITING_FOR)
    assert set(stages.POLICY_STATE.values()) <= {"PENDING_APPROVAL", "AUTO_APPROVED", "DENIED"}
