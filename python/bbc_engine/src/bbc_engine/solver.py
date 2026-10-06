"""Order recovery: when an option takes the case lot away from its order lines, how is
each line covered?

For every affected line the candidates are: FILL_FROM an inventory lot (same product,
organic when the line needs it, enough kg, shelf life at receipt within the customer's
spec on the p90 transit), REPROMISE (filled, but late), or SHORT. The plan minimises
cost + penalties + the tier-A weight on shortfall, subject to each lot's available kg.

Exact enumeration over the (few) lines and candidates; plan Phase 11 named an
assignment MILP, which this replaces - same optimum at this size, no scipy dependency.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from bbc_engine.context import EngineContext
from bbc_engine.physics import rate

MAX_COMBINATIONS = 50_000


@dataclass(frozen=True)
class LinePlan:
    order_line_id: str
    action: str  # FILL_FROM | REPROMISE | SHORT | KEEP
    kg: float
    replacement_lot_id: str | None = None
    from_site_id: str | None = None
    repromise_at: datetime | None = None
    cost_usd: float = 0.0
    penalty_usd: float = 0.0
    tier_a_shortfall_kg: float = 0.0
    sl_at_receipt_days: float | None = None
    eta: datetime | None = None
    snapshot_at: datetime | None = None
    on_time: bool = True

    def as_bundle(self) -> dict[str, Any]:
        return {
            "order_line_id": self.order_line_id,
            "action": self.action,
            "replacement_lot_id": self.replacement_lot_id,
            "from_site_id": self.from_site_id,
            "kg": self.kg,
            "repromise_at": self.repromise_at.strftime("%Y-%m-%dT%H:%M:%SZ")
            if self.repromise_at
            else None,
        }


@dataclass
class RecoveryPlan:
    lines: list[LinePlan] = field(default_factory=list)

    @property
    def cost_usd(self) -> float:
        return sum(p.cost_usd for p in self.lines)

    @property
    def penalty_usd(self) -> float:
        return sum(p.penalty_usd for p in self.lines)

    @property
    def tier_a_shortfall_kg(self) -> float:
        return sum(p.tier_a_shortfall_kg for p in self.lines)

    def objective(self, kappa: float) -> float:
        return self.cost_usd + self.penalty_usd + kappa * self.tier_a_shortfall_kg


def _ts(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def line_value(line: dict[str, Any]) -> float:
    return float(line["kg"]) * float(line["price_usd_per_kg"])


def otif_penalty(line: dict[str, Any]) -> float:
    return (
        line_value(line) * float((line.get("penalty_terms") or {}).get("otif_penalty_pct", 0)) / 100
    )


def short(line: dict[str, Any]) -> LinePlan:
    tier_a = float(line["kg"]) if line.get("customer_tier") == "A" else 0.0
    return LinePlan(
        line["order_line_id"],
        "SHORT",
        float(line["kg"]),
        penalty_usd=otif_penalty(line),
        tier_a_shortfall_kg=tier_a,
        on_time=False,
    )


def fill_candidates(
    line: dict[str, Any], inventory: list[dict[str, Any]], ctx: EngineContext, as_of: datetime
) -> list[LinePlan]:
    """Every feasible way to fill ``line`` from one inventory lot (on time or repromised)."""
    product = ctx.products.get(line["product_id"], {})
    setpoint = float(ctx.p("dc_room_c")) + float(ctx.p("setpoint_offset_c"))
    due = _ts(line["requested_delivery_at"])
    plans = []
    for lot in inventory:
        if lot["product_id"] != line["product_id"]:
            continue
        if line.get("organic_required") and not lot["organic"]:
            continue  # ORGANIC_INTEGRITY: conventional fruit never fills an organic line
        if float(lot["kg_available"]) < float(line["kg"]):
            continue
        lane = ctx.lane(lot["site_id"], line["ship_to_site_id"])
        if lane is None:
            continue
        hours_p90 = float(lane["transit_h_p90"]) + float(ctx.p("replacement_lead_h"))
        sl = (
            float(lot["remaining_shelf_life_days"])
            - hours_p90
            * rate(setpoint, float(product.get("tref_c", 0)), float(product.get("q10", 3)))
            / 24
        )
        if sl < float(line["min_shelf_life_days_at_receipt"]):
            continue
        eta = as_of + timedelta(
            hours=float(ctx.p("replacement_lead_h")) + float(lane["transit_h_p50"])
        )
        freight = (
            ctx.lane_freight(
                lot["site_id"], line["ship_to_site_id"], float(line["kg"]), line["product_id"]
            )
            or 0
        )
        cost = (
            ctx.cost("REPLACEMENT_TRANSFER", lot["site_id"])
            + freight
            + float(line["kg"]) * ctx.cost("HANDLING")
        )
        on_time = eta <= due
        plans.append(
            LinePlan(
                order_line_id=line["order_line_id"],
                action="FILL_FROM" if on_time else "REPROMISE",
                kg=float(line["kg"]),
                replacement_lot_id=lot["lot_id"],
                from_site_id=lot["site_id"],
                repromise_at=None if on_time else eta,
                cost_usd=round(cost, 2),
                penalty_usd=0.0 if on_time else otif_penalty(line),
                sl_at_receipt_days=round(sl, 3),
                eta=eta,
                snapshot_at=_ts(lot["snapshot_at"]),
                on_time=on_time,
            )
        )
    return plans


def solve(
    lines: list[dict[str, Any]],
    inventory: list[dict[str, Any]],
    ctx: EngineContext,
    as_of: datetime,
) -> RecoveryPlan:
    """The cheapest feasible assignment (cost + penalties + kappa x tier-A shortfall)."""
    if not lines:
        return RecoveryPlan()
    kappa = float(ctx.p("tier_a_weight_kappa_usd_per_kg"))
    choices = [[*fill_candidates(line, inventory, ctx, as_of), short(line)] for line in lines]
    available = {lot["lot_id"]: float(lot["kg_available"]) for lot in inventory}
    best: RecoveryPlan | None = None
    total = 1
    for c in choices:
        total *= len(c)
    combos = (
        itertools.product(*choices)
        if total <= MAX_COMBINATIONS
        else [tuple(min(c, key=lambda p: p.cost_usd + p.penalty_usd) for c in choices)]
    )
    for combo in combos:
        used: dict[str, float] = {}
        for plan in combo:
            if plan.replacement_lot_id:
                used[plan.replacement_lot_id] = used.get(plan.replacement_lot_id, 0) + plan.kg
        if any(kg > available.get(lot, 0) + 1e-9 for lot, kg in used.items()):
            continue
        candidate = RecoveryPlan(list(combo))
        if best is None or candidate.objective(kappa) < best.objective(kappa) - 1e-9:
            best = candidate
    assert best is not None  # all-SHORT is always feasible
    return best


def all_short(lines: list[dict[str, Any]]) -> RecoveryPlan:
    return RecoveryPlan([short(line) for line in lines])
