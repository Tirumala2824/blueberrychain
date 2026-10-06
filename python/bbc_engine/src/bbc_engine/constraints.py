"""E3 - hard constraints remove an option (with the reason and its evidence); soft ones
flag it. The default option is the counterfactual: it is always evaluated and never
eliminated, whatever it would lead to.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from bbc_engine.context import EngineContext
from bbc_engine.generator import OptionSpec
from bbc_engine.simulate import Simulated, World

SALE = ("CONTINUE", "EXPEDITE", "REROUTE")
SAFE = ("INSPECT", "HOLD", "DISPOSE")


def eliminations(
    spec: OptionSpec, sim: Simulated, world: World, ctx: EngineContext
) -> list[dict[str, Any]]:
    if spec.is_default:
        return []
    out: list[dict[str, Any]] = []
    evidence = "EV:OPT:{option_id}"  # filled in by the engine once the option has an id
    for lot in world.pack["lots"]:
        if lot.get("food_safety_flag") and spec.disposition not in SAFE:
            out.append(
                {
                    "code": "FOOD_SAFETY",
                    "detail": f"{lot['lot_id']} exceeded a hard food-safety limit; "
                    "only hold, inspect or dispose remain",
                    "evidence_id": evidence,
                }
            )
    minimum = float(ctx.p("min_acceptance_probability"))
    if spec.disposition in SALE and sim.p_accept < minimum:
        sl = sim.outcome["operational"]["sl_at_arrival_days_p50"]
        out.append(
            {
                "code": "SPEC_INFEASIBLE",
                "detail": f"P(accept) {sim.p_accept:.2f} < {minimum:.2f} at {spec.route.site_id}"
                + (
                    f"; arrival shelf life about {sl:.1f} days"
                    f" vs a {spec.route.min_sl_days:g}-day spec"
                    if sl is not None
                    else ""
                ),
                "evidence_id": evidence,
            }
        )
    if spec.window_closes_at is not None:
        ready = world.as_of + timedelta(
            minutes=float(ctx.p("dispatch_lead_min")) + float(ctx.p("approval_buffer_min"))
        )
        if ready > spec.window_closes_at:
            out.append(
                {
                    "code": "WINDOW_CLOSED",
                    "detail": f"executable at {ready:%H:%M}Z with the approval buffer; "
                    f"the re-route window closes {spec.window_closes_at:%H:%M}Z",
                    "evidence_id": evidence,
                }
            )
    if spec.route.capacity_kg is not None and float(spec.route.capacity_kg) < world.kg:
        out.append(
            {
                "code": "CAPACITY",
                "detail": f"{spec.route.site_id} takes {float(spec.route.capacity_kg):g} kg, "
                f"the case is {world.kg:g} kg",
                "evidence_id": evidence,
            }
        )
    if (
        not spec.keeps_lines
        and world.lines
        and world.customer_terms.get("diversion_allowed") is False
    ):
        out.append(
            {
                "code": "CONTRACT_PROHIBITS",
                "detail": "the customer contract forbids diverting committed product",
                "evidence_id": evidence,
            }
        )
    hard_stale_h = float(ctx.p("snapshot_staleness_limit_h")) * 4
    for p in spec.plan.lines if not spec.keeps_lines else []:
        if p.snapshot_at and (world.as_of - p.snapshot_at).total_seconds() / 3600 > hard_stale_h:
            out.append(
                {
                    "code": "INVENTORY_STALE",
                    "detail": f"replacement {p.replacement_lot_id} relies on a stock "
                    f"snapshot older than {hard_stale_h:g} h",
                    "evidence_id": evidence,
                }
            )
    return out


def flags(spec: OptionSpec, sim: Simulated, world: World, ctx: EngineContext) -> list[str]:
    out = []
    if sim.outcome["confidence"]["level"] == "LOW":
        out.append("LOW_CONFIDENCE")
    if any(
        p.snapshot_at
        and (world.as_of - p.snapshot_at).total_seconds() / 3600
        > float(ctx.p("snapshot_staleness_limit_h"))
        for p in (spec.plan.lines if not spec.keeps_lines else [])
    ):
        out.append("INVENTORY_STALE")
    coverage_ok = all(
        next(
            (float(v["value"]) for v in lot["values"] if v["name"] == "MONITORING_COVERAGE_PCT"),
            100.0,
        )
        >= float(ctx.p("min_evidence_coverage_pct"))
        for lot in world.pack["lots"]
    )
    if not coverage_ok and spec.disposition not in ("INSPECT", "HOLD"):
        out.append("INSUFFICIENT_EVIDENCE")
    if any(lot.get("model_validity") == "EXTRAPOLATING" for lot in world.pack["lots"]):
        out.append("MODEL_EXTRAPOLATING")
    if any(lot.get("proxy_air_only") for lot in world.pack["lots"]):
        out.append("PROXY_AIR_ONLY")
    return out
