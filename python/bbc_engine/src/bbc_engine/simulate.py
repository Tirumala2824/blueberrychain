"""E4-E6 - what each option would lead to, by seeded Monte Carlo (plan Phase 11).

Per sample: the lot's true remaining shelf life ~ N(estimate, sigma); whether an
active reefer fault persists (policy ``fault_persistence_prior``) and for how long;
the transit time ~ lognormal through the lane's p50 / p90. Pulp temperature then
follows the route leg by leg (``projection``), arrival shelf life and temperature
decide acceptance against the receiver's spec, and the sample is valued:

    NRV = revenue (or salvage when rejected) - costs - penalties + expected recovery
    expected recovery = P(liable) x P(collect) x min(cap, claimable loss)
    claimable loss    = planned value - revenue + costs + penalties   (mitigation lowers it)

The default ("do nothing") gets P(liable) x the failure-to-mitigate factor. INSPECT is
valued as information: the lot is held and inspected at an own site, the inspection
observes its shelf life with noise, the best onward sale for the *observed* value is
chosen, and the outcome is realised with the *true* value.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from bbc_engine.context import EngineContext
from bbc_engine.generator import OptionSpec, Route, liable_party
from bbc_engine.montecarlo import Draws, mean, quantile, tail_mean
from bbc_engine.physics import rate
from bbc_engine.projection import Leg, run_legs

FAULT_ALARMS = {"COMPRESSOR_FAULT", "DEFROST_TIMEOUT", "HIGH_TEMP"}
SALE = ("CONTINUE", "EXPEDITE", "REROUTE", "DOWNGRADE", "HOLD")


def _ts(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _value(lot: dict[str, Any], name: str) -> float | None:
    return next((float(v["value"]) for v in lot["values"] if v["name"] == name), None)


@dataclass(frozen=True)
class LotIn:
    lot_id: str
    product_id: str
    kg: float
    planned_value: float
    sl_mean: float
    sl_sigma: float
    pulp_c: float
    tref: float
    q10: float


@dataclass
class Simulated:
    outcome: dict[str, Any]
    nrv_mean: float
    nrv_p10: float
    nrv_p90: float
    nrv_tail: float  # mean of the worst 10% (the score's downside term)
    p_accept: float
    p_reject: float
    tier_a_shortfall_kg: float
    confidence_rank: int  # 2 HIGH, 1 MEDIUM, 0 LOW


class World:
    """The case facts the samples share, read once from the pack and the context."""

    def __init__(self, pack: dict[str, Any], ctx: EngineContext, finding: dict[str, Any] | None):
        self.pack, self.ctx = pack, ctx
        self.as_of = _ts(pack["as_of"])
        self.lots = []
        for lot in pack["lots"]:
            product = ctx.products[lot["product_id"]]
            self.lots.append(
                LotIn(
                    lot_id=lot["lot_id"],
                    product_id=lot["product_id"],
                    kg=float(lot["kg"]),
                    planned_value=float(lot["planned_value_usd"]),
                    sl_mean=_value(lot, "REMAINING_SHELF_LIFE_DAYS") or 0.0,
                    sl_sigma=float(lot.get("sigma_days", product.get("prior_sigma_days", 1.0))),
                    pulp_c=float(lot["last_pulp_c"])
                    if lot.get("last_pulp_c") is not None
                    else float(product["threshold_c"]),
                    tref=float(product["tref_c"]),
                    q10=float(product["q10"]),
                )
            )
        self.kg = sum(lot.kg for lot in self.lots)
        self.planned_value = sum(lot.planned_value for lot in self.lots)
        s = pack["shipment"]
        reefer = s.get("reefer_state") or {}
        self.setpoint = float(
            s.get("bol_setpoint_c")
            if s.get("bol_setpoint_c") is not None
            else reefer.get("setpoint_c")
            if reefer.get("setpoint_c") is not None
            else ctx.p("dc_room_c")
        )
        self.fault_active = bool(set(reefer.get("alarms") or []) & FAULT_ALARMS)
        airs = [
            float(reefer[k]) for k in ("supply_air_c", "return_air_c") if reefer.get(k) is not None
        ]
        self.fault_air_c = (
            sum(airs) / len(airs) if airs else max(lot.pulp_c for lot in self.lots) + 5
        )
        self.ambient_c = float(reefer["ambient_c"]) if reefer.get("ambient_c") is not None else None
        self.lines = [x for x in pack["affected_order_lines"] if x.get("assigned_lot_id")]
        self.customer_terms = (
            ctx.contract(self.lines[0]["customer_party_id"], "CUSTOMER_SALES") if self.lines else {}
        )
        self.processors = [d for d in pack["candidate_destinations"] if d["channel"] == "PROCESSOR"]
        # Liability: who pays for what could not be saved.
        self.party, self.party_kind, self.share = liable_party(pack)
        level = (
            (finding or {}).get("confidence", "ATTRIBUTION_ONLY") if finding else "ATTRIBUTION_ONLY"
        )
        p_by = ctx.p("p_liab_by_finding")
        self.p_liab_attribution = float(p_by["ATTRIBUTION_ONLY"]) * self.share
        self.p_liab = float(p_by.get(level, p_by["ATTRIBUTION_ONLY"])) * self.share
        self.cap, self.claim_min, self.p_collect = 0.0, 0.0, 0.0
        if self.party_kind == "CARRIER":
            terms = ctx.contract(self.party, "CARRIER_TRANSPORT")
            self.cap = float(terms.get("liability_cap_usd", 0))
            self.claim_min = float(terms.get("claim_min_usd", 0))
            self.p_collect = float(ctx.p_collect.get(self.party, ctx.p("p_collect_default")))
            if terms.get("requires_bol_setpoint") and s.get("bol_setpoint_c") is None:
                self.p_liab *= float(ctx.p("missing_bol_setpoint_factor"))
        elif self.party_kind == "GROWER":
            terms = ctx.contract(self.party, "GROWER_SUPPLY")
            self.cap = float(terms.get("quality_deduction_cap_pct", 0)) / 100 * self.planned_value
            self.p_collect = 1.0  # deducted from the grower's settlement

    # ------------------------------------------------------------------ pieces
    def reefer_legs(self, hours: float, fault_h: float) -> list[Leg]:
        """While a fault persists the trailer air drifts from its last reading toward the
        outside temperature (when the unit reports it); the pulp follows the air."""
        tau = float(self.ctx.p("reefer_pulp_tau_h"))
        warm = min(fault_h, hours)
        legs = []
        if self.ambient_c is None:
            legs.append(Leg(warm, self.fault_air_c, tau))
        else:
            tau_air = float(self.ctx.p("fault_air_tau_h"))
            steps = max(1, math.ceil(warm / 0.5))
            for i in range(steps):
                mid = (i + 0.5) * warm / steps
                air = self.ambient_c + (self.fault_air_c - self.ambient_c) * math.exp(
                    -mid / tau_air
                )
                legs.append(Leg(warm / steps, air, tau))
        legs.append(Leg(hours - warm, self.setpoint + float(self.ctx.p("setpoint_offset_c")), tau))
        return legs

    def salvage(self, at_site: str, kg: float, product_id: str) -> float:
        """Sell a rejected lot to the nearest processor; never worse than disposal."""
        disposal = -kg * self.ctx.cost("DISPOSAL")
        if not self.processors:
            return disposal
        proc = max(self.processors, key=lambda d: float(d["price_usd_per_kg"]))
        freight = self.ctx.lane_freight(at_site, proc["site_id"], kg, product_id)
        if freight is None:  # no lane from here: the return haul costs about the original lane
            origin = self.pack["shipment"]["origin_site_id"]
            freight = (
                self.ctx.lane_freight(
                    origin, self.pack["shipment"]["destination_site_id"], kg, product_id
                )
                or 0
            )
        return max(
            kg * float(proc["price_usd_per_kg"]) - freight - kg * self.ctx.cost("HANDLING"),
            disposal,
        )

    def recovery(self, loss: float, is_default: bool) -> float:
        if not self.party or loss < self.claim_min or loss <= 0:
            return 0.0
        p = self.p_liab * (float(self.ctx.p("failure_to_mitigate_factor")) if is_default else 1.0)
        return p * self.p_collect * min(self.cap, loss)

    def accepted(self, sl_days: float, temp_c: float, route: Route) -> bool:
        if sl_days < route.min_sl_days:
            return False
        return route.max_arrival_c is None or temp_c <= float(route.max_arrival_c)

    def due(self) -> datetime | None:
        return min((_ts(x["requested_delivery_at"]) for x in self.lines), default=None)


def simulate(spec: OptionSpec, world: World, n: int, seed: int) -> Simulated:
    ctx, as_of = world.ctx, world.as_of
    draws = Draws(seed)
    lo_h, hi_h = float(ctx.p("fault_duration_min_h")), float(ctx.p("fault_duration_max_h"))
    persists = float(ctx.p("fault_persistence_prior"))
    otif_pct = float(world.customer_terms.get("otif_penalty_pct", 0))
    reject_fee = float(world.customer_terms.get("rejection_penalty_usd_per_kg", 0))
    line_value = sum(float(x["kg"]) * float(x["price_usd_per_kg"]) for x in world.lines)
    due = world.due()

    diverts = spec.disposition in ("REROUTE", "DOWNGRADE", "INSPECT")
    # The contract's cost keys: re-route admin is freight-side, DC handling is inspection-side.
    costs = {
        "freight_delta_usd": (spec.route.freight_usd + ctx.cost("REROUTE_ADMIN"))
        if diverts
        else 0.0,
        "expedite_usd": spec.route.freight_usd if spec.disposition == "EXPEDITE" else 0.0,
        # A QC hold: the inspection, DC handling, and the truck and driver waiting (detention).
        "inspection_usd": (
            ctx.cost("INSPECTION", spec.route.site_id)
            + world.kg * ctx.cost("HANDLING")
            + ctx.cost("DETENTION", spec.route.site_id) * float(ctx.p("inspection_delay_h"))
        )
        if spec.disposition == "INSPECT"
        # HOLD: blocked and inspected on arrival (no truck waiting; the receiver's dock does the QC)
        else ctx.cost("INSPECTION", spec.route.site_id) + world.kg * ctx.cost("HANDLING")
        if spec.disposition == "HOLD"
        else 0.0,
        "replacement_usd": spec.plan.cost_usd if not spec.keeps_lines else 0.0,
        "disposal_usd": world.kg * ctx.cost("DISPOSAL") if spec.disposition == "DISPOSE" else 0.0,
    }
    fixed_costs = sum(costs.values())
    plan_penalty = spec.plan.penalty_usd if not spec.keeps_lines else 0.0

    nrv, revenue_s, pen_s, rec_s, onward_s, accept_s, kg_s, sl_s, hours_s, otif_s = (
        [] for _ in range(10)
    )
    lead_lot = max(world.lots, key=lambda lot: lot.kg)
    for _ in range(n):
        fault_h = (
            draws.uniform(lo_h, hi_h) if world.fault_active and draws.chance(persists) else 0.0
        )
        hours = draws.transit_h(spec.route.transit_h_p50, spec.route.transit_h_p90)
        revenue, onward, delivered, all_ok, lead_sl = 0.0, 0.0, 0.0, True, None
        travel = hours
        for lot in world.lots:
            sl0 = max(draws.normal(lot.sl_mean, lot.sl_sigma), 0.0)
            if spec.disposition == "DISPOSE":
                all_ok = False
                continue
            consumed, temp = run_legs(
                lot.pulp_c, world.reefer_legs(hours, fault_h), lot.tref, lot.q10
            )
            sl = sl0 - consumed / 24
            if spec.disposition == "INSPECT":
                value, extra_h, ok, sl, freight = _inspect(spec, world, lot, sl, temp, draws)
                revenue += value
                onward += freight
                travel = hours + extra_h
                delivered += lot.kg if ok else 0.0
                all_ok &= ok
            else:
                ok = world.accepted(sl, temp, spec.route)
                revenue += (
                    lot.kg * spec.route.price_usd_per_kg
                    if ok
                    else world.salvage(spec.route.site_id, lot.kg, lot.product_id)
                )
                delivered += lot.kg if ok else 0.0
                all_ok &= ok
            if lot is lead_lot:
                lead_sl = sl
        penalties = plan_penalty
        on_time = due is None or as_of + timedelta(hours=travel) <= due
        if spec.keeps_lines and world.lines:
            if not all_ok:
                penalties += line_value * otif_pct / 100 + (
                    0.0 if spec.disposition == "HOLD" else reject_fee * world.kg
                )
            elif not on_time:
                penalties += line_value * otif_pct / 100
        otif_s.append(1.0 if (spec.keeps_lines and all_ok and on_time) else 0.0)
        loss = world.planned_value - revenue + fixed_costs + onward + penalties
        recovery = world.recovery(loss, spec.is_default)
        nrv.append(revenue - fixed_costs - onward - penalties + recovery)
        revenue_s.append(revenue)
        pen_s.append(penalties)
        rec_s.append(recovery)
        onward_s.append(onward)
        accept_s.append(1.0 if all_ok else 0.0)
        kg_s.append(delivered)
        hours_s.append(travel)
        if lead_sl is not None:
            sl_s.append(lead_sl)

    if onward_s and mean(onward_s) > 0:  # onward freight after an inspection is freight too
        costs["freight_delta_usd"] += mean(onward_s)
    costs = {k: round(v, 2) for k, v in costs.items() if abs(v) > 0.005}
    p_accept = mean(accept_s)
    keeps = spec.keeps_lines and bool(world.lines)
    p_otif = mean(otif_s) if keeps else None
    tier_a = 0.0
    for line in world.lines:
        if line.get("customer_tier") == "A":
            tier_a += float(line["kg"]) * (1 - p_otif) if keeps else 0.0
    if not spec.keeps_lines:
        tier_a = spec.plan.tier_a_shortfall_kg
    confidence = _confidence(world, spec, mean(nrv), quantile(nrv, 0.1), quantile(nrv, 0.9))
    outcome = {
        "operational": {
            "p_accept": round(p_accept, 4),
            "sl_at_arrival_days_p10": round(quantile(sl_s, 0.1), 3) if sl_s else None,
            "sl_at_arrival_days_p50": round(quantile(sl_s, 0.5), 3) if sl_s else None,
            "sl_at_arrival_days_p90": round(quantile(sl_s, 0.9), 3) if sl_s else None,
            "eta_p50_at": _iso(as_of + timedelta(hours=quantile(hours_s, 0.5)))
            if spec.disposition != "DISPOSE"
            else None,
            "eta_p90_at": _iso(as_of + timedelta(hours=quantile(hours_s, 0.9)))
            if spec.disposition != "DISPOSE"
            else None,
            "kg_delivered_expected": round(mean(kg_s), 3),
        },
        "financial": {
            "expected_revenue_usd": round(mean(revenue_s), 2),
            "costs": costs,
            "expected_penalties_usd": round(mean(pen_s), 2),
            "expected_recovery_usd": round(mean(rec_s), 2),
            "expected_nrv_usd": round(mean(nrv), 2),
            "nrv_p10_usd": round(quantile(nrv, 0.1), 2),
            "nrv_p90_usd": round(quantile(nrv, 0.9), 2),
            "expected_loss_usd": round(world.planned_value - mean(nrv), 2),
            "value_preserved_vs_default_usd": 0.0,
        },
        "risk": {
            "p_reject": round(1 - p_accept, 4)
            if spec.disposition in SALE or spec.disposition == "INSPECT"
            else 0.0,
            "food_safety_flag": any(
                lot.get("food_safety_flag", False) for lot in world.pack["lots"]
            ),
            "evidence_risk": _evidence_risk(world),
        },
        "customer": {
            "lines_affected": len(world.lines),
            "p_otif_by_line": [
                {
                    "order_line_id": line["order_line_id"],
                    "p_otif": round(
                        p_otif
                        if keeps
                        else (
                            1.0
                            if _plan_for(spec, line).on_time
                            and _plan_for(spec, line).action != "SHORT"
                            else 0.0
                        ),
                        4,
                    ),
                }
                for line in world.lines
            ],
            "tier_a_shortfall_kg": round(tier_a, 3),
        },
        "logistics": {
            "added_hours": round(
                mean(hours_s)
                - (_ts(world.pack["shipment"]["eta_p50_at"]) - as_of).total_seconds() / 3600,
                2,
            )
            if spec.disposition != "DISPOSE"
            else 0.0,
            "carrier_change": False,
            "new_appointments": 0
            if spec.disposition in ("CONTINUE", "EXPEDITE", "HOLD", "DISPOSE")
            else 1 + sum(1 for p in spec.plan.lines if p.action in ("FILL_FROM", "REPROMISE")),
        },
        "inventory": {
            "atp_consumed": [
                {
                    "site_id": p.from_site_id,
                    "lot_id": p.replacement_lot_id,
                    "kg": p.kg,
                    "share_of_site_atp": round(_share_of_atp(world, p), 4),
                }
                for p in (spec.plan.lines if not spec.keeps_lines else [])
                if p.replacement_lot_id
            ],
            "atp_added_kg": 0.0,
        },
        "recovery_cost_usd": round(sum(costs.values()), 2),
        "confidence": confidence,
    }
    rank = {"HIGH": 2, "MEDIUM": 1, "LOW": 0}[confidence["level"]]
    return Simulated(
        outcome,
        mean(nrv),
        quantile(nrv, 0.1),
        quantile(nrv, 0.9),
        tail_mean(nrv),
        p_accept,
        outcome["risk"]["p_reject"],
        tier_a,
        rank,
    )


def _plan_for(spec: OptionSpec, line: dict[str, Any]):
    return next(p for p in spec.plan.lines if p.order_line_id == line["order_line_id"])


def _share_of_atp(world: World, plan) -> float:
    total = sum(
        float(i["kg_available"])
        for i in world.pack["candidate_inventory"]
        if i["site_id"] == plan.from_site_id
    )
    return min(plan.kg / total, 1.0) if total else 1.0


def _inspect(
    spec: OptionSpec, world: World, lot: LotIn, sl_at_dc: float, temp: float, draws: Draws
):
    """Hold, inspect, then sell where the *observed* shelf life supports; realise with the truth."""
    ctx = world.ctx
    hold = Leg(
        float(ctx.p("inspection_delay_h")), float(ctx.p("dc_room_c")), float(ctx.p("dc_pulp_tau_h"))
    )
    consumed, temp = run_legs(temp, [hold], lot.tref, lot.q10)
    true_sl = sl_at_dc - consumed / 24
    observed = true_sl + draws.normal(0.0, float(ctx.p("inspection_sigma_days")))
    cold = float(ctx.p("dc_room_c")) + float(ctx.p("setpoint_offset_c"))
    best = None
    for d in world.pack["candidate_destinations"]:
        lane = ctx.lane(spec.route.site_id, d["site_id"])
        if lane is None:
            continue
        predicted = observed - float(lane["transit_h_p50"]) * rate(cold, lot.tref, lot.q10) / 24
        freight = ctx.lane_freight(spec.route.site_id, d["site_id"], lot.kg, lot.product_id) or 0.0
        sellable = predicted >= float(d["min_shelf_life_days_at_receipt"]) + float(
            ctx.p("decision_margin_days")
        )
        value = (
            lot.kg * float(d["price_usd_per_kg"])
            if sellable
            else world.salvage(d["site_id"], lot.kg, lot.product_id)
        ) - freight
        if best is None or value > best[0]:
            best = (value, d, lane, freight)
    hold_h = float(ctx.p("inspection_delay_h"))
    if best is None:  # nowhere to go from the inspection site: salvage there
        return (
            world.salvage(spec.route.site_id, lot.kg, lot.product_id),
            hold_h,
            False,
            true_sl,
            0.0,
        )
    _, d, lane, freight = best
    onward_h = draws.transit_h(float(lane["transit_h_p50"]), float(lane["transit_h_p90"]))
    used, arrival_c = run_legs(
        temp, [Leg(onward_h, cold, float(ctx.p("reefer_pulp_tau_h")))], lot.tref, lot.q10
    )
    sl_arrival = true_sl - used / 24
    route = Route(
        d["site_id"],
        d["party_id"],
        d["channel"],
        float(d["price_usd_per_kg"]),
        0,
        0,
        float(d["min_shelf_life_days_at_receipt"]),
        d.get("max_arrival_pulp_c"),
        0,
        None,
        None,
        None,
    )
    ok = world.accepted(sl_arrival, arrival_c, route)
    revenue = (
        lot.kg * float(d["price_usd_per_kg"])
        if ok
        else world.salvage(d["site_id"], lot.kg, lot.product_id)
    )
    return revenue, hold_h + onward_h, ok, sl_arrival, freight


def _evidence_risk(world: World) -> str:
    conflicts = sum(
        1
        for doc in world.pack["documents"]
        for c in doc["claims"]
        if (c.get("consistency") or {}).get("verdict") == "CONFLICT"
    )
    coverage = min(
        (_value(lot, "MONITORING_COVERAGE_PCT") or 0 for lot in world.pack["lots"]), default=0
    )
    if conflicts or coverage < float(world.ctx.p("min_evidence_coverage_pct")):
        return "HIGH"
    return "MEDIUM" if world.pack["data_gaps"] else "LOW"


def _confidence(world: World, spec: OptionSpec, e: float, p10: float, p90: float) -> dict[str, Any]:
    drivers, level = [], 2
    validity = {lot.get("model_validity", "IN_RANGE") for lot in world.pack["lots"]}
    if "EXTRAPOLATING" in validity:
        drivers.append("model EXTRAPOLATING")
        level = min(level, 0)
    elif "UNCALIBRATED" in validity:
        drivers.append("model UNCALIBRATED (no outcomes yet)")
        level = min(level, 1)
    else:
        drivers.append("model IN_RANGE")
    coverage = min(
        (_value(lot, "MONITORING_COVERAGE_PCT") or 0 for lot in world.pack["lots"]), default=0
    )
    drivers.append(f"monitoring coverage {coverage:.0f}%")
    if coverage < float(world.ctx.p("min_evidence_coverage_pct")):
        level = min(level, 0)
    conflicts = sum(
        1
        for doc in world.pack["documents"]
        for c in doc["claims"]
        if (c.get("consistency") or {}).get("verdict") == "CONFLICT"
    )
    drivers.append(f"{conflicts} evidence conflict(s)" if conflicts else "no evidence conflicts")
    if conflicts:
        level = min(level, 1)
    if any(
        p.snapshot_at
        and (world.as_of - p.snapshot_at).total_seconds() / 3600
        > float(world.ctx.p("snapshot_staleness_limit_h"))
        for p in spec.plan.lines
    ):
        drivers.append("replacement stock snapshot is stale")
        level = min(level, 1)
    width = (p90 - p10) / max(abs(e), 1.0)
    if width > 0.5:
        drivers.append(f"wide value range ({width:.0%} of expected)")
        level = min(level, 1)
    return {"level": ["LOW", "MEDIUM", "HIGH"][level], "drivers": drivers[:10]}
