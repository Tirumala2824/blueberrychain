"""Seal an evidence pack from a simulated world at ``as_of`` - what BUILD_ASSESSMENT
does in Snowflake (WP6), computed here from the same front-door data: the probe and
reefer readings, the TMS plan and position, the SAP order and stock, the world's
reference data. It never looks at the simulator's ground truth.

Used to evaluate scenarios end to end before the Snowflake procedures exist (golden
tests, scenario tuning) and as the reference for the procedure's output.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any

from bbc_engine import physics as ph

from blueberrychain.sim.clock import iso, utc
from blueberrychain.sim.trip import LotPlan, ShipmentPlan, Trip

HOLDER_TYPES = {
    "OWN": "DC",
    "GROWER": "GROWER",
    "CARRIER": "CARRIER",
    "CUSTOMER": "CUSTOMER",
    "PROCESSOR": "PROCESSOR",
    "PACKHOUSE": "PACKHOUSE",
}
# Re-route destinations: every buyer whose reference record names a spot sales channel
# (party.sales_channel). The contract customer's own channel is the plan, not a diversion.
SPOT_CHANNELS = ("REGIONAL", "FOODSERVICE", "PROCESSOR")


def _hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _readings(lot: LotPlan, messages: list[dict[str, Any]], as_of: datetime) -> list[ph.Reading]:
    stamp = iso(as_of)
    out = []
    for m in messages:
        if m["device_id"] == lot.probe_device_id and m["ts"] <= stamp and "pulp_c" in m["values"]:
            ts = utc(m["ts"])
            seg = lot.segment_at(ts - timedelta(seconds=1))
            out.append(
                ph.Reading(
                    ts, m["interval_s"], m["values"]["pulp_c"], seg.holder_party_id if seg else None
                )
            )
    return out


def _model(world: dict[str, Any], product_id: str) -> ph.ShelfLifeModel:
    return ph.ShelfLifeModel.from_product(
        next(p for p in world["products"] if p["product_id"] == product_id)
    )


def _value(
    name: str,
    value: Any,
    unit: str,
    grain: str,
    as_of: datetime,
    pack_id: str,
    path: str,
    age: float | None = 0,
):
    return {
        "name": name,
        "value": value,
        "unit": unit,
        "grain": grain,
        "as_of": iso(as_of),
        "data_age_min": age,
        "freshness": "OK",
        "metric_version": "1",
        "evidence_id": f"EV:PACK:{pack_id}#{path}",
    }


def _food_safety(
    readings: list[ph.Reading], threshold: float, limits: list[dict[str, Any]]
) -> bool:
    """Hard limits govern temperature abuse of *cooled* product: from the first reading at or
    below the threshold (field heat before pre-cooling is the grower contract's matter)."""
    started = next((i for i, r in enumerate(readings) if r.temp_c <= threshold), None)
    if started is None:
        return False
    for limit in limits:
        minutes = sum(
            r.interval_s / 60 for r in readings[started:] if r.temp_c > float(limit["max_pulp_c"])
        )
        if minutes > float(limit["max_minutes_above"]):
            return True
    return False


DETECTION_LAG_MIN = 2  # Dynamic Table lag (1 min) + the triggered task


def detect(
    world: dict[str, Any],
    policy: dict[str, Any],
    trip: Trip,
    messages: list[dict[str, Any]],
    as_of: datetime,
) -> dict[str, Any] | None:
    """DECISION.OPEN_CASES's rule (bbc_toolkit.cases) over the readings received by ``as_of``:
    counted breach minutes in the trailing window above the product's tolerance. Counted =
    outside the pre-cool window, and after the cold chain started or while a non-grower holds
    the lot. Returns the onset (start of the current breach run) and its holder, or None."""
    lot = trip.lots[0]
    product = next(p for p in world["products"] if p["product_id"] == lot.product_id)
    terms = next(
        c["terms"]
        for c in world["contracts"]
        if c["party_id"] == lot.grower_party_id and c["contract_type"] == "GROWER_SUPPLY"
    )
    precool_end = lot.harvest_at + timedelta(hours=terms["precool_max_hours"])
    threshold = float(product["threshold_c"])
    readings = _readings(lot, messages, as_of)
    if not readings:
        return None
    cold = next((r.ts for r in readings if r.temp_c <= threshold), None)
    last = readings[-1].ts
    counted = [
        r
        for r in readings
        if r.ts > precool_end
        and (r.holder != lot.grower_party_id or (cold is not None and r.ts >= cold))
    ]
    since = last - timedelta(minutes=float(policy["parameters"]["detection_window_min"]))
    window = [r for r in counted if r.ts > since]
    breach = sum(r.interval_s / 60 for r in window if r.temp_c > threshold)
    if breach <= float(product["tolerance_min"]):
        return None
    last_ok = max((r.ts for r in counted if r.temp_c <= threshold), default=None)
    run = [r for r in counted if r.temp_c > threshold and (last_ok is None or r.ts > last_ok)]
    first = run[0] if run else next(r for r in window if r.temp_c > threshold)
    return {"onset_at": first.ts, "holder": first.holder, "breach_min": breach, "detected_at": last}


def opened_at(
    world: dict[str, Any],
    policy: dict[str, Any],
    trip: Trip,
    messages: list[dict[str, Any]],
    after: datetime,
) -> datetime | None:
    """When OPEN_CASES opens the case: the first probe reading after ``after`` at which the
    rule holds, plus the detection lag."""
    lot = trip.lots[0]
    for m in messages:
        ts = utc(m["ts"])
        if m["device_id"] != lot.probe_device_id or ts <= after:
            continue
        if detect(world, policy, trip, messages, ts):
            return ts + timedelta(minutes=DETECTION_LAG_MIN)
    return None


def _junction(world: dict[str, Any], lane_id: str) -> tuple[str, float] | None:
    lanes = {(lane["origin_site_id"], lane["dest_site_id"]): lane for lane in world["lanes"]}
    lane = next(lane for lane in world["lanes"] if lane["lane_id"] == lane_id)
    for site in world["sites"]:
        if site["site_type"] == "JUNCTION":
            first = lanes.get((lane["origin_site_id"], site["site_id"]))
            if first and (site["site_id"], lane["dest_site_id"]) in lanes:
                return site["site_id"], float(first["transit_h_p50"])
    return None


def assess(
    world: dict[str, Any],
    policy: dict[str, Any],
    trip: Trip,
    messages: list[dict[str, Any]],
    as_of: datetime,
    *,
    case_id: str = "CASE-00000001",
    pack_id: str = "PACK-00000001",
    revision: int = 1,
) -> dict[str, Any]:
    lot = trip.lots[0]
    shipment: ShipmentPlan = next(
        s for s in trip.shipments if any(x == lot.lot_id for x, _ in s.lots)
    )
    order = next(o for o in trip.orders if o.lot_id == lot.lot_id)
    parties = {p["party_id"]: p for p in world["parties"]}
    sites = {s["site_id"]: s for s in world["sites"]}
    lanes = {(lane["origin_site_id"], lane["dest_site_id"]): lane for lane in world["lanes"]}
    product = next(p for p in world["products"] if p["product_id"] == lot.product_id)
    model = _model(world, lot.product_id)
    readings = _readings(lot, messages, as_of)
    state = ph.lot_state(model, lot.harvest_at, readings)
    grower_terms = next(
        c["terms"]
        for c in world["contracts"]
        if c["party_id"] == lot.grower_party_id and c["contract_type"] == "GROWER_SUPPLY"
    )
    exposure = ph.custody_exposure(
        readings,
        model,
        attributable_after=lot.harvest_at + timedelta(hours=grower_terms["precool_max_hours"]),
    )
    spec = next(
        s
        for s in world["customer_specs"]
        if s["customer_party_id"] == order.customer_party_id and s["product_id"] == lot.product_id
    )
    customer_terms = next(
        c["terms"]
        for c in world["contracts"]
        if c["party_id"] == order.customer_party_id and c["contract_type"] == "CUSTOMER_SALES"
    )
    planned_value = lot.kg * order.price_usd_per_kg
    cold = float(world["thermal"]["room_setpoint_c"]) + 0.3

    # Where the truck is, when it arrives, and what it can still reach.
    first = shipment.legs[0]
    remaining_p50 = remaining_p90 = 0.0
    for leg in shipment.legs:
        lane = (
            next(lane for lane in world["lanes"] if lane["lane_id"] == leg.lane_id)
            if leg.lane_id
            else None
        )
        span = (leg.end - leg.start).total_seconds() / 3600
        left = max((leg.end - max(as_of, leg.start)).total_seconds() / 3600, 0.0)
        ratio = float(lane["transit_h_p90"]) / float(lane["transit_h_p50"]) if lane else 1.0
        remaining_p50 += min(left, span)
        remaining_p90 += min(left, span) * ratio
    junction = _junction(world, first.lane_id or "")
    closes = first.start + timedelta(hours=junction[1]) if junction else None
    before_junction = closes is not None and as_of < closes
    to_junction_h = max((closes - as_of).total_seconds() / 3600, 0.0) if before_junction else 0.0
    if as_of < shipment.departure:
        status = "LOADING"
    elif as_of >= shipment.arrival:
        status = "DELIVERED"
    else:
        status = next(
            ("AT_DOCK" if leg.kind == "DOCK" else "IN_TRANSIT")
            for leg in shipment.legs
            if leg.start <= as_of < leg.end
        )
    reefer = [
        m
        for m in messages
        if m["device_id"] == trip.trucks[shipment.truck_id] and m["ts"] <= iso(as_of)
    ]
    reefer_state = None
    if reefer:
        v = reefer[-1]["values"]
        reefer_state = {
            "as_of": reefer[-1]["ts"],
            "mode": v.get("mode"),
            "alarms": v.get("alarms", []),
            "supply_air_c": v.get("supply_air_c"),
            "return_air_c": v.get("return_air_c"),
            "setpoint_c": v.get("setpoint_c"),
            "ambient_c": v.get("ambient_c"),
        }

    destinations = []
    if before_junction:
        buyers = [
            (p["party_id"], p["sales_channel"])
            for p in world["parties"]
            if p.get("sales_channel") in SPOT_CHANNELS
        ]
        for party_id, channel in buyers:
            site_id = next(s["site_id"] for s in world["sites"] if s["party_id"] == party_id)
            lane = lanes.get((junction[0], site_id))
            if lane is None or site_id == shipment.destination_site_id:
                continue
            dspec = next(
                (
                    s
                    for s in world["customer_specs"]
                    if s["customer_party_id"] == party_id and s["product_id"] == lot.product_id
                ),
                None,
            )
            price = next(
                p["price_usd_per_kg"]
                for p in world["channel_prices"]
                if p["product_id"] == lot.product_id and p["channel"] == channel
            )
            share = min(lot.kg / (float(product["kg_per_pallet"]) * 20), 1.0)
            destinations.append(
                {
                    "site_id": site_id,
                    "party_id": party_id,
                    "channel": channel,
                    "customer_tier": parties[party_id].get("customer_tier"),
                    "price_usd_per_kg": price,
                    "transit_h_p50": round(to_junction_h + float(lane["transit_h_p50"]), 3),
                    "transit_h_p90": round(to_junction_h + float(lane["transit_h_p90"]), 3),
                    "min_shelf_life_days_at_receipt": dspec["min_shelf_life_days_at_receipt"]
                    if dspec
                    else 1,
                    "capacity_kg": sites[site_id].get("dock_capacity_kg_per_day"),
                    "max_arrival_pulp_c": dspec["max_arrival_pulp_c"] if dspec else None,
                    "freight_usd": round(float(lane["cost_per_load_usd"]) * share, 2),
                    "evidence_id": f"EV:PACK:{pack_id}#/candidate_destinations/{len(destinations)}",
                }
            )
    inspection = []
    dc = "SITE-CVDC-TRACY"
    if before_junction and (junction[0], dc) in lanes and shipment.destination_site_id != dc:
        lane = lanes[(junction[0], dc)]
        share = min(lot.kg / (float(product["kg_per_pallet"]) * 20), 1.0)
        inspection.append(
            {
                "site_id": dc,
                "transit_h_p50": round(to_junction_h + float(lane["transit_h_p50"]), 3),
                "transit_h_p90": round(to_junction_h + float(lane["transit_h_p90"]), 3),
                "freight_usd": round(float(lane["cost_per_load_usd"]) * share, 2),
                "evidence_id": f"EV:PACK:{pack_id}#/inspection_sites/0",
            }
        )

    inventory = []
    for i, other in enumerate(trip.lots[1:]):
        seg = other.segment_at(as_of)
        if seg is None or seg.kind != "DC_COLD":
            continue
        other_state = ph.lot_state(
            _model(world, other.product_id), other.harvest_at, _readings(other, messages, as_of)
        )
        inventory.append(
            {
                "lot_id": other.lot_id,
                "site_id": seg.site_id,
                "product_id": other.product_id,
                "organic": next(
                    p["organic"] for p in world["products"] if p["product_id"] == other.product_id
                ),
                "kg_available": other.kg,
                "remaining_shelf_life_days": round(other_state.remaining_shelf_life_days, 3),
                "snapshot_at": iso(
                    as_of - timedelta(minutes=as_of.minute % 15, seconds=as_of.second)
                ),
                "evidence_id": f"EV:PACK:{pack_id}#/candidate_inventory/{i}",
            }
        )

    timeline: list[dict[str, Any]] = []
    for seg in lot.segments:
        if seg.start >= as_of:
            break
        holder_type = HOLDER_TYPES[parties[seg.holder_party_id]["party_type"]]
        if timeline and timeline[-1]["party_id"] == seg.holder_party_id:
            timeline[-1]["to_at"] = iso(min(seg.end, as_of)) if seg.end <= as_of else None
            continue
        if timeline:
            timeline[-1]["to_at"] = iso(seg.start)
        timeline.append(
            {
                "party_id": seg.holder_party_id,
                "holder_type": holder_type,
                "site_id": seg.site_id,
                "from_at": iso(seg.start),
                "to_at": iso(seg.end) if seg.end <= as_of else None,
                "evidence_id": f"EV:PACK:{pack_id}#/custody_timeline/{len(timeline)}",
            }
        )

    eta_p50 = as_of + timedelta(hours=remaining_p50)
    eta_p90 = as_of + timedelta(hours=remaining_p90)
    predicted_sl = ph.project_shelf_life_days(
        state.remaining_shelf_life_h, remaining_p90, cold, model.tref_c, model.q10
    )
    value_at_risk = planned_value if predicted_sl < spec["min_shelf_life_days_at_receipt"] else 0.0
    validity = "IN_RANGE"
    if any(
        not product["validity_min_temp_c"] <= r.temp_c <= product["validity_max_temp_c"]
        for r in readings
    ):
        validity = "EXTRAPOLATING"
    age = (as_of - state.as_of).total_seconds() / 60 if state.as_of else None
    exposures = []
    for e in exposure.values():
        exposures.append(
            {
                "holder_party_id": e.holder,
                "holder_type": HOLDER_TYPES[parties[e.holder]["party_type"]],
                "excess_life_share": round(e.excess_life_share, 6)
                if e.excess_life_share is not None
                else None,
                "thermal_exposure_deg_h": round(e.degree_min_above / 60, 3),
                "breach_min": round(e.breach_min, 1),
                "evidence_id": f"EV:PACK:{pack_id}#/lots/0/custody_exposure/{len(exposures)}",
            }
        )
    pack = {
        "pack_id": pack_id,
        "case_id": case_id,
        "decision_point": "D1",
        "revision": revision,
        "as_of": iso(as_of),
        "sealed_at": iso(as_of + timedelta(seconds=12)),
        "param_versions": {
            "policy": str(policy["policy_version"]),
            "semantic": "1",
            "engine": "0.1.0",
            "products": "1",
            "contracts": "1",
            "prices": "1",
            "cost_rates": "1",
            "lanes": "1",
        },
        "shipment": {
            "shipment_id": shipment.shipment_id,
            "carrier_party_id": shipment.carrier_party_id,
            "reefer_device_id": trip.trucks[shipment.truck_id],
            "origin_site_id": shipment.origin_site_id,
            "destination_site_id": shipment.destination_site_id,
            "bol_setpoint_c": shipment.bol_setpoint_c,
            "state_at_as_of": status,
            "next_junction_site_id": junction[0] if before_junction else None,
            "eta_p50_at": iso(eta_p50),
            "eta_p90_at": iso(eta_p90),
            "reefer_state": reefer_state,
            "evidence_id": f"EV:PACK:{pack_id}#/shipment",
        },
        "lots": [
            {
                "lot_id": lot.lot_id,
                "product_id": lot.product_id,
                "organic": product["organic"],
                "kg": lot.kg,
                "planned_value_usd": round(planned_value, 2),
                "grower_party_id": lot.grower_party_id,
                "harvest_at": iso(lot.harvest_at),
                "primary_probe_device_id": lot.probe_device_id,
                "proxy_air_only": False,
                "last_pulp_c": readings[-1].temp_c if readings else None,
                "last_reading_at": iso(readings[-1].ts) if readings else None,
                "food_safety_flag": _food_safety(
                    readings, model.threshold_c, policy["hard_limits"]
                ),
                "model_validity": validity,
                "sigma_days": float(product["prior_sigma_days"]),
                "values": [
                    _value(
                        "REMAINING_SHELF_LIFE_DAYS",
                        round(state.remaining_shelf_life_days, 4),
                        "days",
                        "lot",
                        state.as_of or as_of,
                        pack_id,
                        "/lots/0/values/0",
                        age,
                    ),
                    _value(
                        "MONITORING_COVERAGE_PCT",
                        round(state.monitoring_coverage_pct or 0, 2),
                        "%",
                        "lot",
                        state.as_of or as_of,
                        pack_id,
                        "/lots/0/values/1",
                        age,
                    ),
                    _value(
                        "TEMPERATURE_COMPLIANCE_PCT",
                        round(state.temperature_compliance_pct or 0, 2),
                        "%",
                        "lot",
                        state.as_of or as_of,
                        pack_id,
                        "/lots/0/values/2",
                        age,
                    ),
                    _value(
                        "VALUE_AT_RISK_USD",
                        round(value_at_risk, 2),
                        "USD",
                        "case_lot",
                        as_of,
                        pack_id,
                        "/lots/0/values/3",
                    ),
                ],
                "custody_exposure": exposures,
            }
        ],
        "custody_timeline": timeline,
        "affected_order_lines": [
            {
                "order_line_id": f"SO-{order.sales_order}-{order.item}",
                "customer_party_id": order.customer_party_id,
                "customer_tier": parties[order.customer_party_id].get("customer_tier"),
                "product_id": order.product_id,
                "organic_required": spec["organic_required"],
                "kg": order.kg,
                "price_usd_per_kg": order.price_usd_per_kg,
                "requested_delivery_at": iso(order.requested_delivery_at),
                "ship_to_site_id": order.ship_to_site_id,
                "min_shelf_life_days_at_receipt": spec["min_shelf_life_days_at_receipt"],
                "max_arrival_pulp_c": spec["max_arrival_pulp_c"],
                "assigned_lot_id": lot.lot_id,
                "penalty_terms": {"otif_penalty_pct": customer_terms["otif_penalty_pct"]},
                "evidence_id": f"EV:PACK:{pack_id}#/affected_order_lines/0",
            }
        ],
        "candidate_inventory": inventory,
        "candidate_destinations": destinations,
        "inspection_sites": inspection,
        "documents": [],
        "data_gaps": [],
        "deadline_inputs": {
            "windows": [{"kind": "REROUTE", "site_id": junction[0], "closes_at": iso(closes)}]
            if before_junction
            else []
        },
    }
    pack["content_hash"] = _hash(pack)
    return pack
