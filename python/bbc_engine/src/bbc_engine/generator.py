"""E2 - the action space: every candidate bundle for one case and decision point (D1).

* Disposition: CONTINUE (the default: the plan as it stands, no recovery actions),
  EXPEDITE, REROUTE to each regional / foodservice buyer, DOWNGRADE to each processor,
  INSPECT at each own inspection site, HOLD (continue, block and inspect on arrival),
  DISPOSE (only when food safety or exhausted shelf life makes it a real choice).
* Order recovery for every option that takes the lot off its order lines: the
  solver's best plan, plus an all-SHORT variant kept for comparison.
* Financial: a CLAIM_NOTICE to the external holder with most of the attributable
  excess life (when at least ``claim_notice_min_share``) on every option except the
  default - notice is cheap and preserves rights. Grower recovery is a D2 deduction.

Constraints (E3) and outcomes (E4-E6) are applied later; nothing is pruned here
except options that are physically impossible (no lane, no destination).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from bbc_engine import solver
from bbc_engine.context import EngineContext


@dataclass(frozen=True)
class Route:
    """Where the lots go and how long it takes from the current position."""

    site_id: str
    party_id: str | None
    channel: str  # CONTRACT (the original customer), REGIONAL, FOODSERVICE, PROCESSOR, DC
    price_usd_per_kg: float
    transit_h_p50: float
    transit_h_p90: float
    min_sl_days: float
    max_arrival_c: float | None
    freight_usd: float
    capacity_kg: float | None
    tier: str | None
    evidence_id: str | None


@dataclass
class OptionSpec:
    key: str  # stable signature: the option's seed and identity across revisions
    label: str
    disposition: str
    route: Route
    is_default: bool = False
    is_fallback: bool = False
    keeps_lines: bool = True  # the lots stay on their order lines
    plan: solver.RecoveryPlan = field(default_factory=solver.RecoveryPlan)
    financial: list[dict[str, Any]] = field(default_factory=list)
    window_closes_at: datetime | None = None
    window_evidence: str | None = None


def _ts(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def liable_party(pack: dict[str, Any]) -> tuple[str | None, str | None, float]:
    """(party, holder type, share) of the external holder with the most attributable excess."""
    shares: dict[tuple[str, str], float] = {}
    total_kg = sum(float(lot["kg"]) for lot in pack["lots"])
    for lot in pack["lots"]:
        for e in lot["custody_exposure"]:
            if (
                e.get("holder_type") in ("CARRIER", "GROWER", "PACKHOUSE")
                and e.get("excess_life_share") is not None
            ):
                key = (
                    e["holder_party_id"],
                    "GROWER" if e["holder_type"] == "PACKHOUSE" else e["holder_type"],
                )
                shares[key] = (
                    shares.get(key, 0) + float(e["excess_life_share"]) * float(lot["kg"]) / total_kg
                )
    if not shares:
        return None, None, 0.0
    (party, kind), share = max(shares.items(), key=lambda kv: kv[1])
    return party, kind, share


def _original_route(pack: dict[str, Any]) -> Route:
    as_of = _ts(pack["as_of"])
    s = pack["shipment"]
    line = next((x for x in pack["affected_order_lines"] if x.get("assigned_lot_id")), None)
    p50 = max((_ts(s["eta_p50_at"]) - as_of).total_seconds() / 3600, 0.0)
    p90 = max((_ts(s["eta_p90_at"]) - as_of).total_seconds() / 3600, p50)
    return Route(
        site_id=s["destination_site_id"],
        party_id=line["customer_party_id"] if line else None,
        channel="CONTRACT",
        price_usd_per_kg=float(line["price_usd_per_kg"]) if line else 0.0,
        transit_h_p50=p50,
        transit_h_p90=p90,
        min_sl_days=float(line["min_shelf_life_days_at_receipt"]) if line else 0.0,
        max_arrival_c=line.get("max_arrival_pulp_c") if line else None,
        freight_usd=0.0,
        capacity_kg=None,
        tier=line.get("customer_tier") if line else None,
        evidence_id=s.get("evidence_id"),
    )


def _window(pack: dict[str, Any], kind: str) -> tuple[datetime | None, str | None]:
    for w in pack["deadline_inputs"]["windows"]:
        if w["kind"] == kind:
            return _ts(w["closes_at"]), w.get("site_id")
    return None, None


def generate(pack: dict[str, Any], ctx: EngineContext) -> list[OptionSpec]:
    as_of = _ts(pack["as_of"])
    kg = sum(float(lot["kg"]) for lot in pack["lots"])
    lots_label = ", ".join(lot["lot_id"] for lot in pack["lots"])
    original = _original_route(pack)
    lines = [x for x in pack["affected_order_lines"] if x.get("assigned_lot_id")]
    party, kind, share = liable_party(pack)
    notice = []
    if party and kind == "CARRIER" and share >= float(ctx.p("claim_notice_min_share")):
        notice = [
            {
                "action": "CLAIM_NOTICE",
                "counterparty_party_id": party,
                "basis": "CARRIER_TEMPERATURE",
                "amount_usd": None,
                "variant": None,
            }
        ]
    reroute_closes, _ = _window(pack, "REROUTE")
    food_safety = any(lot.get("food_safety_flag") for lot in pack["lots"])
    best_plan = solver.solve(lines, pack["candidate_inventory"], ctx, as_of)
    short_plan = solver.all_short(lines)

    specs = [
        OptionSpec(
            "DEFAULT",
            f"Do nothing: continue {lots_label} to {original.site_id} as planned",
            "CONTINUE",
            original,
            is_default=True,
        )
    ]
    product = pack["lots"][0]["product_id"]
    origin = pack["shipment"]["origin_site_id"]
    lane_cost = ctx.lane_freight(origin, original.site_id, kg, product) or 0.0
    if original.transit_h_p50 > 0 and not food_safety:
        factor = float(ctx.p("expedite_transit_factor"))
        fast = Route(
            **{
                **original.__dict__,
                "transit_h_p50": original.transit_h_p50 * factor,
                "transit_h_p90": original.transit_h_p90 * factor,
                "freight_usd": lane_cost * ctx.cost("EXPEDITE_PREMIUM") / 100,
            }
        )  # the premium, see simulate
        specs.append(
            OptionSpec(
                "EXPEDITE",
                f"Expedite {lots_label} to {original.site_id} (team drivers)",
                "EXPEDITE",
                fast,
                financial=notice,
            )
        )

    for d in pack["candidate_destinations"]:
        route = Route(
            site_id=d["site_id"],
            party_id=d["party_id"],
            channel=d["channel"],
            price_usd_per_kg=float(d["price_usd_per_kg"]),
            transit_h_p50=float(d["transit_h_p50"]),
            transit_h_p90=float(d["transit_h_p90"]),
            min_sl_days=float(d["min_shelf_life_days_at_receipt"]),
            max_arrival_c=d.get("max_arrival_pulp_c"),
            freight_usd=float(d.get("freight_usd") or 0.0),
            capacity_kg=d.get("capacity_kg"),
            tier=d.get("customer_tier"),
            evidence_id=d.get("evidence_id"),
        )
        disposition = "DOWNGRADE" if d["channel"] == "PROCESSOR" else "REROUTE"
        verb = "Downgrade" if disposition == "DOWNGRADE" else "Re-route"
        for plan, suffix, tag in (
            (best_plan, _plan_label(best_plan), "PLAN"),
            (short_plan, "short the order line", "SHORT"),
        ):
            if (
                tag == "SHORT"
                and plan.objective(0) == best_plan.objective(0)
                and plan.lines == best_plan.lines
            ):
                continue  # the best plan already is all-short
            if food_safety:
                continue
            specs.append(
                OptionSpec(
                    key=f"{disposition}:{d['site_id']}:{tag}",
                    label=f"{verb} {lots_label} to {d['site_id']}; {suffix}"[:200],
                    disposition=disposition,
                    route=route,
                    keeps_lines=False,
                    plan=plan,
                    financial=notice,
                    window_closes_at=reroute_closes,
                )
            )

    plan_label = _plan_label(best_plan)
    for i, site in enumerate(pack.get("inspection_sites", [])):
        route = Route(
            site_id=site["site_id"],
            party_id=None,
            channel="DC",
            price_usd_per_kg=0.0,
            transit_h_p50=float(site["transit_h_p50"]),
            transit_h_p90=float(site["transit_h_p90"]),
            min_sl_days=0.0,
            max_arrival_c=None,
            freight_usd=float(site.get("freight_usd") or 0.0),
            capacity_kg=None,
            tier=None,
            evidence_id=site.get("evidence_id"),
        )
        specs.append(
            OptionSpec(
                key=f"INSPECT:{site['site_id']}",
                label=f"Hold {lots_label} for inspection at {site['site_id']}; {plan_label}"[:200],
                disposition="INSPECT",
                route=route,
                is_fallback=(i == 0),
                keeps_lines=False,
                plan=best_plan,
                financial=notice,
                window_closes_at=reroute_closes,
            )
        )
    specs.append(
        OptionSpec(
            "HOLD",
            f"Continue {lots_label}; block and inspect on arrival at {original.site_id}",
            "HOLD",
            original,
            is_fallback=not pack.get("inspection_sites"),
            financial=notice,
        )
    )
    sl_min = min(_value(lot, "REMAINING_SHELF_LIFE_DAYS") for lot in pack["lots"])
    if food_safety or sl_min <= 1.0:
        specs.append(
            OptionSpec(
                "DISPOSE",
                f"Dispose of {lots_label}",
                "DISPOSE",
                original,
                keeps_lines=False,
                plan=best_plan,
                financial=notice,
            )
        )
    return specs


def _value(lot: dict[str, Any], name: str) -> float:
    return float(next(v["value"] for v in lot["values"] if v["name"] == name))


def _plan_label(plan: solver.RecoveryPlan) -> str:
    parts = []
    for p in plan.lines:
        if p.action == "FILL_FROM":
            parts.append(
                f"refill {p.order_line_id} from {p.replacement_lot_id} at {p.from_site_id}"
            )
        elif p.action == "REPROMISE":
            parts.append(f"refill {p.order_line_id} late from {p.replacement_lot_id}")
        else:
            parts.append(f"short {p.order_line_id}")
    return "; ".join(parts) or "no order lines affected"


def expires_at(spec: OptionSpec, pack: dict[str, Any]) -> datetime:
    """Latest execution time: the re-route window for diversions, the planned arrival otherwise."""
    if spec.window_closes_at is not None:
        return spec.window_closes_at
    return (
        _ts(pack["shipment"]["eta_p50_at"])
        if spec.disposition != "INSPECT"
        else _ts(pack["as_of"]) + timedelta(hours=6)
    )
