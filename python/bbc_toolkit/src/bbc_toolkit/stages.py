"""UNDERSTANDING -> OPTIONS -> RECOMMENDATION -> GOVERNANCE: the pure logic of the WP6b stage
procedures (handlers in ``bbc_toolkit.stage_procs``).

* ``assemble_pack`` seals the evidence pack from governed rows (OPS, REF, the semantic view),
  field for field what ``blueberrychain.sim.assess`` builds from simulator objects - so the
  engine sees the same shape in Snowflake as in the golden tests.
* ``rule_finding`` is the deterministic attribution recorded when no causal question needs an
  agent: it reports custody exposure and makes no liability claim (``unadjudicated``).
* ``bundle_actions`` turns a scored option into the governed actions it would execute. Policy
  evaluation and the execution plan both use it, so what was authorized is what runs.
* ``evaluate_bundle`` applies ``bbc_engine.autonomy`` to those actions.

Time: ``as_of`` is the event-time watermark of the case's data (the latest reading received),
so a pack reads the same in a live world and in an accelerated simulation; ``sealed_at`` is the
wall-clock seal. Replay rebuilds from readings with ``reading_ts <= as_of`` that had arrived by
``sealed_at``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from itertools import pairwise
from typing import Any

from bbc_toolkit import cases, ledger

# The engine is imported lazily: both packages are imported by the stage procedures, but the
# toolkit stays importable on its own (connectors, CLI).
SPOT_CHANNELS = ("REGIONAL", "FOODSERVICE", "PROCESSOR")
STATUS_TO_STATE = {"ARRIVED": "DELIVERED", "DEPARTED": "IN_TRANSIT"}
SHIPMENT_STATES = ("PLANNED", "LOADING", "IN_TRANSIT", "AT_DOCK", "DELIVERED", "REJECTED")
OPEN_LINE_STATUSES_EXCLUDED = ("DELIVERED", "CANCELLED", "REJECTED")

# Case lifecycle (contracts/schemas/common.json case_state). Each deterministic stage moves a
# case from one state to the next; anything else waits for a person, an agent or the gateway.
ADVANCE_STEPS = {
    "OPEN": "BUILD_ASSESSMENT",
    "ASSESSED": "ROUTE",
    "FINDING_RECORDED": "GENERATE_AND_SCORE_OPTIONS",
    "OPTIONS_SCORED": "ROUTE",
    "RECOMMENDED": "AUDIT_GATE",
    "AUDITED": "EVALUATE_POLICY",
}
WAITING_FOR = {
    "FORENSICS_PENDING": ("AGENT", "EXCURSION_FORENSICS"),
    "STRATEGY_PENDING": ("AGENT", "RECOVERY_STRATEGIST"),
    "CLAIMS_PENDING": ("AGENT", "CLAIMS_RECOVERY"),
    "AUDIT_PENDING": ("AGENT", "EVIDENCE_AUDITOR"),
    "PENDING_APPROVAL": ("HUMAN", "DECIDE_APPROVAL"),
    "APPROVED": ("ENGINE", "EXECUTE_PLAN"),
    "AUTO_APPROVED": ("ENGINE", "EXECUTE_PLAN"),
}
POLICY_STATE = {
    "APPROVE": "PENDING_APPROVAL",
    "HUMAN_INITIATE": "PENDING_APPROVAL",
    "AUTO": "AUTO_APPROVED",
    "DENY": "DENIED",
    "OBSERVE_ONLY": "DENIED",
}

# Execution order (plan Phase 12): protective first, then the re-route, then order changes,
# then customer notices, irreversible steps last.
STEP_ORDER = {
    "STOCK_BLOCK": 1,
    "CLAIM_NOTICE": 1,
    "REQUEST_EVIDENCE": 1,
    "REROUTE": 2,
    "SO_CREATE": 3,
    "SO_CHANGE": 3,
    "REPLACEMENT_ALLOCATION": 3,
    "REPROMISE_NOTICE": 4,
    "DISPOSE": 5,
}


# ------------------------------------------------------------------------------- helpers
def parse_ts(text: str | datetime) -> datetime:
    if isinstance(text, datetime):
        return text
    return datetime.fromisoformat(str(text).replace("Z", "+00:00"))


def iso(moment: datetime | str | None) -> str | None:
    if moment is None:
        return None
    if isinstance(moment, str):
        return iso(parse_ts(moment))
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _value(name, value, unit, grain, as_of, pack_id, path, age=0):
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


def food_safety_flag(readings: list[dict[str, Any]], threshold_c: float, limits) -> bool:
    """Hard limits govern temperature abuse of *cooled* product: from the first reading at or
    below the threshold (field heat before pre-cooling is the grower contract's matter)."""
    started = next((i for i, r in enumerate(readings) if r["pulp_c"] <= threshold_c), None)
    if started is None:
        return False
    for limit in limits:
        minutes = sum(
            r["interval_s"] / 60
            for r in readings[started:]
            if r["pulp_c"] > float(limit["max_pulp_c"])
        )
        if minutes > float(limit["max_minutes_above"]):
            return True
    return False


def model_validity(readings: list[dict[str, Any]], product: dict[str, Any]) -> str:
    low, high = float(product["validity_min_temp_c"]), float(product["validity_max_temp_c"])
    return "EXTRAPOLATING" if any(not low <= r["pulp_c"] <= high for r in readings) else "IN_RANGE"


def data_gaps(readings: list[dict[str, Any]], device_id: str) -> list[dict[str, Any]]:
    """Unmonitored stretches: a reading arriving more than one interval after its predecessor."""
    gaps = []
    for prev, cur in pairwise(readings):
        start = parse_ts(prev["reading_ts"])
        end = parse_ts(cur["reading_ts"]) - timedelta(seconds=int(cur["interval_s"]))
        minutes = (end - start).total_seconds() / 60
        if minutes > 1:
            gaps.append(
                {
                    "device_id": device_id,
                    "from_at": iso(start),
                    "to_at": iso(end),
                    "minutes": round(minutes, 1),
                }
            )
    return gaps


def merge_timeline(intervals: list[dict[str, Any]], as_of: datetime, pack_id: str, parties):
    """Custody intervals (at, next_at] -> the pack's timeline, consecutive holders merged."""
    out: list[dict[str, Any]] = []
    for row in intervals:
        start = parse_ts(row["from_at"])
        if start >= as_of:
            break
        end = parse_ts(row["to_at"]) if row.get("to_at") else None
        closed = iso(end) if end is not None and end <= as_of else None
        if out and out[-1]["party_id"] == row["party_id"]:
            out[-1]["to_at"] = closed
            continue
        if out:
            out[-1]["to_at"] = iso(start)
        out.append(
            {
                "party_id": row["party_id"],
                "holder_type": cases.HOLDER_TYPES.get(parties[row["party_id"]]["party_type"]),
                "site_id": row.get("site_id"),
                "from_at": iso(start),
                "to_at": closed,
                "evidence_id": f"EV:PACK:{pack_id}#/custody_timeline/{len(out)}",
            }
        )
    return out


# ---------------------------------------------------------------------------------- pack
def assemble_pack(src: dict[str, Any]) -> dict[str, Any]:
    """The evidence pack from governed inputs (see ``stage_procs.load_pack_inputs``).

    ``src`` carries: case_id, pack_id, revision, decision_point, as_of, sealed_at,
    param_versions, policy (document), ref (parties, sites, lanes, products, specs, contracts,
    prices), shipment (+ departed_at), reefer (latest reading or None), lots (each with its
    semantic-view values, exposures, readings, probe), order_lines, inventory, timeline.
    """
    from bbc_engine import physics as ph
    from bbc_engine.context import DEFAULTS

    as_of = parse_ts(src["as_of"])
    pack_id = src["pack_id"]
    ref = src["ref"]
    parties = {p["party_id"]: p for p in ref["parties"]}
    sites = {s["site_id"]: s for s in ref["sites"]}
    lanes = {(lane["origin_site_id"], lane["dest_site_id"]): lane for lane in ref["lanes"]}
    products = {p["product_id"]: p for p in ref["products"]}
    params = {**DEFAULTS, **src["policy"]["parameters"]}
    shipment = src["shipment"]
    first = src["lots"][0]
    product = products[first["product_id"]]

    def spec_for(party_id, product_id):
        return next(
            (
                s
                for s in ref["specs"]
                if s["customer_party_id"] == party_id and s["product_id"] == product_id
            ),
            None,
        )

    def terms(party_id, contract_type):
        return next(
            (
                c["terms"]
                for c in ref["contracts"]
                if c["party_id"] == party_id and c["contract_type"] == contract_type
            ),
            {},
        )

    # Where the truck is, when it arrives, and what it can still reach.
    origin, dest = shipment["origin_site_id"], shipment["destination_site_id"]
    junction = next(
        (
            (s["site_id"], float(lanes[(origin, s["site_id"])]["transit_h_p50"]))
            for s in ref["sites"]
            if s["site_type"] == "JUNCTION"
            and (origin, s["site_id"]) in lanes
            and (s["site_id"], dest) in lanes
        ),
        None,
    )
    path = (
        [lanes[(origin, junction[0])], lanes[(junction[0], dest)]]
        if junction
        else [lanes[(origin, dest)]]
        if (origin, dest) in lanes
        else []
    )
    ratio = (
        sum(float(x["transit_h_p90"]) for x in path) / sum(float(x["transit_h_p50"]) for x in path)
        if path
        else 1.0
    )
    departed = parse_ts(shipment["departed_at"])
    eta = parse_ts(shipment["eta_at"] or shipment["planned_arrival_at"])
    remaining_p50 = max((eta - as_of).total_seconds() / 3600, 0.0)
    remaining_p90 = remaining_p50 * ratio
    closes = departed + timedelta(hours=junction[1]) if junction else None
    before_junction = closes is not None and as_of < closes
    to_junction_h = max((closes - as_of).total_seconds() / 3600, 0.0) if before_junction else 0.0
    state = STATUS_TO_STATE.get(shipment["status"], shipment["status"])
    if state not in SHIPMENT_STATES:
        state = "IN_TRANSIT"
    reefer = src.get("reefer")
    reefer_state = (
        {
            "as_of": iso(reefer["reading_ts"]),
            "mode": reefer.get("mode"),
            "alarms": reefer.get("alarms") or [],
            "supply_air_c": reefer.get("supply_air_c"),
            "return_air_c": reefer.get("return_air_c"),
            "setpoint_c": reefer.get("setpoint_c"),
            "ambient_c": reefer.get("ambient_c"),
        }
        if reefer
        else None
    )
    share = min(float(first["kg"]) / (float(product["kg_per_pallet"]) * 20), 1.0)

    destinations = []
    if before_junction:
        for party in ref["parties"]:
            channel = party.get("sales_channel")
            if channel not in SPOT_CHANNELS:
                continue
            site_id = next(
                (s["site_id"] for s in ref["sites"] if s["party_id"] == party["party_id"]), None
            )
            lane = lanes.get((junction[0], site_id)) if site_id else None
            if lane is None or site_id == dest:
                continue
            dspec = spec_for(party["party_id"], first["product_id"])
            price = next(
                p["price_usd_per_kg"]
                for p in ref["prices"]
                if p["product_id"] == first["product_id"] and p["channel"] == channel
            )
            destinations.append(
                {
                    "site_id": site_id,
                    "party_id": party["party_id"],
                    "channel": channel,
                    "customer_tier": party.get("customer_tier"),
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
    own_dcs = [
        s["site_id"]
        for s in ref["sites"]
        if s["site_type"] == "DC" and parties[s["party_id"]]["party_type"] == "OWN"
    ]
    for dc in own_dcs:
        if before_junction and (junction[0], dc) in lanes and dest != dc:
            lane = lanes[(junction[0], dc)]
            inspection.append(
                {
                    "site_id": dc,
                    "transit_h_p50": round(to_junction_h + float(lane["transit_h_p50"]), 3),
                    "transit_h_p90": round(to_junction_h + float(lane["transit_h_p90"]), 3),
                    "freight_usd": round(float(lane["cost_per_load_usd"]) * share, 2),
                    "evidence_id": f"EV:PACK:{pack_id}#/inspection_sites/{len(inspection)}",
                }
            )

    case_lot_ids = {lot["lot_id"] for lot in src["lots"]}
    inventory = [
        {
            "lot_id": i["lot_id"],
            "site_id": i["site_id"],
            "product_id": i["product_id"],
            "organic": bool(products[i["product_id"]]["organic"]),
            "kg_available": float(i["atp_kg"]),
            "remaining_shelf_life_days": round(float(i["remaining_shelf_life_days"]), 3),
            "snapshot_at": iso(i["snapshot_at"]),
            "evidence_id": f"EV:PACK:{pack_id}#/candidate_inventory/{n}",
        }
        for n, i in enumerate(
            i
            for i in src["inventory"]
            if i["lot_id"] not in case_lot_ids
            and i["site_id"] in own_dcs
            and float(i["atp_kg"]) > 0
            and i.get("remaining_shelf_life_days") is not None
        )
    ]

    lines = [
        o
        for o in src["order_lines"]
        if o["assigned_lot_id"] in case_lot_ids and o["status"] not in OPEN_LINE_STATUSES_EXCLUDED
    ]
    affected = []
    for n, o in enumerate(lines):
        spec = spec_for(o["customer_party_id"], o["product_id"]) or {}
        affected.append(
            {
                "order_line_id": o["order_line_id"],
                "customer_party_id": o["customer_party_id"],
                "customer_tier": parties.get(o["customer_party_id"], {}).get("customer_tier"),
                "product_id": o["product_id"],
                "organic_required": bool(spec.get("organic_required", False)),
                "kg": float(o["kg"]),
                "price_usd_per_kg": float(o["price_usd_per_kg"]),
                "requested_delivery_at": iso(o["requested_delivery_at"]),
                "ship_to_site_id": o["ship_to_site_id"],
                "min_shelf_life_days_at_receipt": spec.get("min_shelf_life_days_at_receipt", 1),
                "max_arrival_pulp_c": spec.get("max_arrival_pulp_c"),
                "assigned_lot_id": o["assigned_lot_id"],
                "penalty_terms": {
                    "otif_penalty_pct": terms(o["customer_party_id"], "CUSTOMER_SALES").get(
                        "otif_penalty_pct", 0
                    )
                },
                "evidence_id": f"EV:PACK:{pack_id}#/affected_order_lines/{n}",
            }
        )

    cold = float(params["dc_room_c"]) + float(params["setpoint_offset_c"])
    pack_lots, gaps = [], []
    for li, lot in enumerate(src["lots"]):
        prod = products[lot["product_id"]]
        readings = lot["readings"]
        line = next((x for x in lines if x["assigned_lot_id"] == lot["lot_id"]), None)
        price = float(line["price_usd_per_kg"]) if line else 0.0
        planned_value = float(lot["kg"]) * price
        sv = lot["values"]
        lot_as_of = parse_ts(sv["as_of"])
        age = round((as_of - lot_as_of).total_seconds() / 60, 1)
        predicted_sl = ph.project_shelf_life_days(
            float(sv["remaining_shelf_life_days"]) * 24,
            remaining_p90,
            cold,
            float(prod["tref_c"]),
            float(prod["q10"]),
        )
        spec = spec_for(line["customer_party_id"], lot["product_id"]) if line else None
        value_at_risk = (
            planned_value
            if spec and predicted_sl < float(spec["min_shelf_life_days_at_receipt"])
            else 0.0
        )
        base = f"/lots/{li}/values"
        pack_lots.append(
            {
                "lot_id": lot["lot_id"],
                "product_id": lot["product_id"],
                "organic": bool(prod["organic"]),
                "kg": float(lot["kg"]),
                "planned_value_usd": round(planned_value, 2),
                "grower_party_id": lot["grower_party_id"],
                "harvest_at": iso(lot["harvest_at"]),
                "primary_probe_device_id": lot.get("probe_device_id"),
                "proxy_air_only": False,
                "last_pulp_c": readings[-1]["pulp_c"] if readings else None,
                "last_reading_at": iso(readings[-1]["reading_ts"]) if readings else None,
                "food_safety_flag": food_safety_flag(
                    readings, float(prod["threshold_c"]), src["policy"]["hard_limits"]
                ),
                "model_validity": model_validity(readings, prod),
                "sigma_days": float(prod["prior_sigma_days"]),
                "values": [
                    _value(
                        "REMAINING_SHELF_LIFE_DAYS",
                        round(float(sv["remaining_shelf_life_days"]), 4),
                        "days",
                        "lot",
                        lot_as_of,
                        pack_id,
                        f"{base}/0",
                        age,
                    ),
                    _value(
                        "MONITORING_COVERAGE_PCT",
                        round(float(sv["monitoring_coverage_pct"] or 0), 2),
                        "%",
                        "lot",
                        lot_as_of,
                        pack_id,
                        f"{base}/1",
                        age,
                    ),
                    _value(
                        "TEMPERATURE_COMPLIANCE_PCT",
                        round(float(sv["temperature_compliance_pct"] or 0), 2),
                        "%",
                        "lot",
                        lot_as_of,
                        pack_id,
                        f"{base}/2",
                        age,
                    ),
                    _value(
                        "VALUE_AT_RISK_USD",
                        round(value_at_risk, 2),
                        "USD",
                        "case_lot",
                        as_of,
                        pack_id,
                        f"{base}/3",
                    ),
                ],
                "custody_exposure": [
                    {
                        "holder_party_id": e["holder_party_id"],
                        "holder_type": cases.HOLDER_TYPES.get(
                            parties[e["holder_party_id"]]["party_type"]
                        ),
                        "excess_life_share": round(float(e["excess_life_share"]), 6)
                        if e.get("excess_life_share") is not None
                        else None,
                        "thermal_exposure_deg_h": round(float(e["thermal_exposure_deg_h"]), 3),
                        "breach_min": round(float(e["breach_min"]), 1),
                        "evidence_id": f"EV:PACK:{pack_id}#/lots/{li}/custody_exposure/{n}",
                    }
                    for n, e in enumerate(lot["exposures"])
                ],
            }
        )
        if lot.get("probe_device_id"):
            gaps += data_gaps(readings, lot["probe_device_id"])

    pack = {
        "pack_id": pack_id,
        "case_id": src["case_id"],
        "decision_point": src["decision_point"],
        "revision": int(src["revision"]),
        "as_of": iso(as_of),
        "sealed_at": iso(src["sealed_at"]),
        "param_versions": src["param_versions"],
        "shipment": {
            "shipment_id": shipment["shipment_id"],
            "carrier_party_id": shipment["carrier_party_id"],
            "reefer_device_id": shipment.get("reefer_device_id"),
            "origin_site_id": origin,
            "destination_site_id": dest,
            "bol_setpoint_c": shipment.get("bol_setpoint_c"),
            "state_at_as_of": state,
            "next_junction_site_id": junction[0] if before_junction else None,
            "eta_p50_at": iso(as_of + timedelta(hours=remaining_p50)),
            "eta_p90_at": iso(as_of + timedelta(hours=remaining_p90)),
            "reefer_state": reefer_state,
            "evidence_id": f"EV:PACK:{pack_id}#/shipment",
        },
        "lots": pack_lots,
        "custody_timeline": merge_timeline(src["timeline"], as_of, pack_id, parties),
        "affected_order_lines": affected,
        "candidate_inventory": inventory,
        "candidate_destinations": destinations,
        "inspection_sites": inspection,
        "documents": [],
        "data_gaps": gaps,
        "deadline_inputs": {
            "windows": [{"kind": "REROUTE", "site_id": junction[0], "closes_at": iso(closes)}]
            if before_junction
            else []
        },
    }
    pack["content_hash"] = ledger.canonical_hash(pack)
    return pack


def deadline(pack: dict[str, Any], policy: dict[str, Any]) -> datetime | None:
    """When the safe fallback runs: the first option window to close, less the dispatch lead."""
    from bbc_engine.context import DEFAULTS

    closes = [parse_ts(w["closes_at"]) for w in pack["deadline_inputs"]["windows"]]
    if not closes:
        return None
    lead = float(policy["parameters"].get("dispatch_lead_min", DEFAULTS["dispatch_lead_min"]))
    return min(closes) - timedelta(minutes=lead)


# ------------------------------------------------------------------------------ finding
def rule_finding(pack: dict[str, Any]) -> dict[str, Any]:
    """Deterministic attribution (no causal question was raised): which custody holders the
    excess shelf-life loss fell on, by the governed EXCESS_LIFE_SHARE. Attribution is not
    liability, so it names no responsible party and stays unadjudicated."""
    citations, parts = [], []
    for lot in pack["lots"]:
        for e in lot["custody_exposure"]:
            citations.append(e["evidence_id"])
            if e["excess_life_share"]:
                parts.append(
                    f"{lot['lot_id']}: {e['excess_life_share']:.0%} of attributable excess life "
                    f"with {e['holder_party_id']} ({e['holder_type']})"
                )
    citations = list(dict.fromkeys(citations))[:100]
    return {
        "hypotheses": [{"cause": "UNKNOWN", "verdict": "INCONCLUSIVE", "evidence_ids": citations}],
        "most_likely_cause": "UNKNOWN",
        "responsible_parties": [],
        "evidence_trust": [],
        "sufficiency": "INSUFFICIENT",
        "gaps": [],
        "confidence": "LOW",
        "confidence_reasons": [
            "Deterministic custody attribution only; no causal adjudication was requested."
        ],
        "narrative": (
            "Custody attribution: " + ("; ".join(parts) if parts else "no attributable excess")
        )[:3000]
        + ".",
        "citations": citations,
    }


# ------------------------------------------------------------------------------ actions
def bundle_actions(option: dict[str, Any], pack: dict[str, Any]) -> list[dict[str, Any]]:
    """The governed actions a scored option executes, in plan order, each with what it commits
    (the decision-rights value band) and the entity it changes."""
    f = option["outcome"]["financial"]
    out: list[dict[str, Any]] = []
    shipment_id = pack["shipment"]["shipment_id"]
    lines = {x["order_line_id"]: x for x in pack["affected_order_lines"]}
    for lot in option["bundle"]["lots"]:
        d, site = lot["disposition"], lot.get("destination_site_id")
        if d in ("REROUTE", "INSPECT", "DOWNGRADE") and site:
            out.append(
                {
                    "action_type": "REROUTE",
                    "target_system": "TMS",
                    "target_entity": {"type": "SHIPMENT", "id": shipment_id},
                    "payload": {
                        "shipment_id": shipment_id,
                        "lot_id": lot["lot_id"],
                        "new_destination_site_id": site,
                        "disposition": d,
                    },
                    "value_usd": float(f["expected_revenue_usd"]),
                }
            )
        if d == "INSPECT":
            out.append(
                {
                    "action_type": "STOCK_BLOCK",
                    "target_system": "SAP",
                    "target_entity": {"type": "LOT_STOCK", "id": f"{lot['lot_id']}@{site}"},
                    "payload": {"lot_id": lot["lot_id"], "site_id": site, "kg": lot["kg"]},
                    "value_usd": 0.0,
                }
            )
        if d == "DOWNGRADE":
            out.append(
                {
                    "action_type": "SO_CREATE",
                    "target_system": "SAP",
                    "target_entity": {"type": "SALES_ORDER_ITEM", "id": f"NEW:{lot['lot_id']}"},
                    "payload": {"lot_id": lot["lot_id"], "ship_to_site_id": site, "kg": lot["kg"]},
                    "value_usd": float(f["expected_revenue_usd"]),
                }
            )
        if d == "DISPOSE":
            out.append(
                {
                    "action_type": "DISPOSE",
                    "target_system": "SAP",
                    "target_entity": {"type": "LOT_STOCK", "id": lot["lot_id"]},
                    "payload": {"lot_id": lot["lot_id"], "kg": lot["kg"]},
                    "value_usd": float(lot["kg"])
                    * float(
                        next(
                            (
                                x["price_usd_per_kg"]
                                for x in lines.values()
                                if x["assigned_lot_id"] == lot["lot_id"]
                            ),
                            0.0,
                        )
                    ),
                }
            )
    for r in option["bundle"]["order_recovery"]:
        line = lines.get(r["order_line_id"], {})
        price = float(line.get("price_usd_per_kg", 0.0))
        if r["action"] == "FILL_FROM":
            out.append(
                {
                    "action_type": "REPLACEMENT_ALLOCATION",
                    "target_system": "SAP",
                    "target_entity": {"type": "SALES_ORDER_ITEM", "id": r["order_line_id"]},
                    "payload": {
                        "order_line_id": r["order_line_id"],
                        "replacement_lot_id": r["replacement_lot_id"],
                        "from_site_id": r["from_site_id"],
                        "kg": r["kg"],
                    },
                    "value_usd": round(float(r["kg"]) * price, 2),
                }
            )
        elif r["action"] in ("SHORT", "PARTIAL"):
            out.append(
                {
                    "action_type": "SO_CHANGE",
                    "target_system": "SAP",
                    "target_entity": {"type": "SALES_ORDER_ITEM", "id": r["order_line_id"]},
                    "payload": {"order_line_id": r["order_line_id"], "kg": r["kg"]},
                    "value_usd": round(float(line.get("kg", 0)) * price, 2),
                }
            )
        elif r["action"] == "REPROMISE":
            out.append(
                {
                    "action_type": "REPROMISE_NOTICE",
                    "target_system": "CUSTOMER_EDI",
                    "target_entity": {"type": "SALES_ORDER_ITEM", "id": r["order_line_id"]},
                    "payload": {
                        "order_line_id": r["order_line_id"],
                        "repromise_at": r["repromise_at"],
                    },
                    "value_usd": round(float(line.get("kg", 0)) * price, 2),
                }
            )
    for a in option["bundle"]["financial"]:
        if a["action"] == "CLAIM_NOTICE":
            out.append(
                {
                    "action_type": "CLAIM_NOTICE",
                    "target_system": "CARRIER",
                    "target_entity": {
                        "type": "CLAIM",
                        "id": f"{pack['case_id']}:{a['counterparty_party_id']}",
                    },
                    "payload": {
                        "counterparty_party_id": a["counterparty_party_id"],
                        "basis": a["basis"],
                        "shipment_id": shipment_id,
                    },
                    "value_usd": abs(float(a["amount_usd"] or 0)),
                }
            )
    out.sort(key=lambda a: STEP_ORDER.get(a["action_type"], 9))
    for seq, a in enumerate(out, start=1):
        a["step_seq"] = seq
    return out


def evaluate_bundle(
    option: dict[str, Any],
    pack: dict[str, Any],
    policy: dict[str, Any],
    *,
    decider_kind: str,
    value_at_risk_usd: float,
    auditor_pass: bool | None = None,
) -> dict[str, Any]:
    """Decision rights + autonomy for every action of the bundle, and the combined verdict."""
    from bbc_engine.autonomy import Action, authorize, combine, option_metrics

    tiers = tuple(
        sorted({x["customer_tier"] for x in pack["affected_order_lines"] if x["customer_tier"]})
    )
    flagged = any(lot.get("food_safety_flag") for lot in pack["lots"])
    actions, results = bundle_actions(option, pack), []
    for a in actions:
        metrics = option_metrics(
            option, pack, a["action_type"], policy, value_at_risk_usd=value_at_risk_usd
        )
        auth = authorize(
            Action(
                a["action_type"],
                pack["decision_point"],
                decider_kind,
                float(a["value_usd"]),
                metrics,
                customer_tiers=tiers,
                food_safety_flag=flagged,
                auditor_pass=auditor_pass,
                is_fallback=bool(option.get("is_fallback")) and decider_kind == "FALLBACK",
            ),
            policy,
        )
        results.append((a, auth))
    if not results:  # doing nothing still needs a recorded verdict
        return {
            "outcome": "AUTO",
            "level": int(policy["parameters"]["autonomy_ceiling"]),
            "required_roles": [],
            "dual_approval": False,
            "shadow": bool(policy["parameters"]["shadow_mode"]),
            "dispatch": bool(policy["parameters"]["dispatch_enabled"]),
            "matched_rules": [],
            "reasons": ["no external action: the plan continues"],
            "actions": [],
        }
    bundle = combine(auth for _, auth in results)
    return {
        "outcome": bundle.outcome,
        "level": bundle.level,
        "required_roles": list(bundle.required_roles),
        "dual_approval": bundle.dual_approval,
        "shadow": bundle.shadow,
        "dispatch": bundle.dispatch,
        "matched_rules": list(bundle.matched_rules),
        "reasons": list(bundle.reasons),
        "actions": [
            {
                "step_seq": a["step_seq"],
                "action_type": a["action_type"],
                "target_entity": a["target_entity"],
                "value_usd": a["value_usd"],
                "outcome": auth.outcome,
                "level": auth.level,
                "required_roles": list(auth.required_roles),
                "matched_rules": list(auth.matched_rules),
                "reasons": list(auth.reasons),
                "dimensions": [dict(d) for d in auth.dimensions],
            }
            for a, auth in results
        ],
    }
