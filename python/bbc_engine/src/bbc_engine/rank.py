"""E7-E8 - rank the feasible options and decide who decides.

Score (policy-defined, objective@1):

    S = E[NRV] - lambda x (E[NRV] - ES10) - kappa x tier-A shortfall kg

where ES10 is the mean of the worst 10% of sampled NRVs (plan Phase 11 wrote P10; a percentile
misses rare large losses - with 2% rejections P10 can exceed the mean - so the downside term
uses the tail mean).
Dominance (Pareto) over: E[NRV], P10, P(reject), tier-A shortfall, confidence.

A rule decides when the top option beats the runner-up by more than the near-tie margin
and no router trigger fires; otherwise the case escalates with reason codes. Triggers
that need judgment over evidence (conflicting documents, ambiguous cause) are raised
earlier, at UNDERSTANDING (``understanding_triggers``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bbc_engine.context import EngineContext
from bbc_engine.simulate import Simulated

OBJECTIVE_VERSION = "objective@1"
RULE_ID = "R-DISP-01@1"


@dataclass
class Scored:
    key: str
    sim: Simulated
    feasible: bool
    is_default: bool
    score: float = 0.0
    rank: int | None = None
    dominated_by: tuple[str, ...] = ()


def risk_adjusted(sim: Simulated, ctx: EngineContext) -> float:
    lam = float(ctx.p("risk_aversion_lambda"))
    kappa = float(ctx.p("tier_a_weight_kappa_usd_per_kg"))
    return sim.nrv_mean - lam * (sim.nrv_mean - sim.nrv_tail) - kappa * sim.tier_a_shortfall_kg


def _vector(s: Scored) -> tuple[float, ...]:
    return (
        s.sim.nrv_mean,
        s.sim.nrv_p10,
        -s.sim.p_reject,
        -s.sim.tier_a_shortfall_kg,
        float(s.sim.confidence_rank),
    )


def dominates(a: Scored, b: Scored) -> bool:
    va, vb = _vector(a), _vector(b)
    return all(x >= y - 1e-9 for x, y in zip(va, vb, strict=True)) and any(
        x > y + 1e-9 for x, y in zip(va, vb, strict=True)
    )


def rank(items: list[Scored], ctx: EngineContext) -> list[Scored]:
    feasible = [s for s in items if s.feasible]
    for s in items:
        s.score = risk_adjusted(s.sim, ctx)
    for s in feasible:
        s.dominated_by = tuple(o.key for o in feasible if o is not s and dominates(o, s))
    ordered = sorted(feasible, key=lambda s: (-s.score, s.key))
    for i, s in enumerate(ordered, start=1):
        s.rank = i
    return ordered


def weakly_dominates(a: Scored, b: Scored) -> bool:
    return all(x >= y - 1e-9 for x, y in zip(_vector(a), _vector(b), strict=True))


def margin(ordered: list[Scored]) -> float | None:
    """Top score minus the best *real* alternative: the best other option the top does not
    (weakly) dominate. A dominated or equivalent option is no trade-off, so it never makes
    a near-tie."""
    if not ordered:
        return None
    top = ordered[0]
    rivals = [s for s in ordered[1:] if not weakly_dominates(top, s)]
    return top.score - rivals[0].score if rivals else None


def score_gap(ordered: list[Scored]) -> float | None:
    """Top score minus the runner-up's, whatever their dominance (the Brief's top-2 margin)."""
    return ordered[0].score - ordered[1].score if len(ordered) > 1 else None


def recommendation_triggers(
    ordered: list[Scored], value_at_risk: float, pack: dict[str, Any], ctx: EngineContext
) -> list[str]:
    reasons: list[str] = []
    real = [s for s in ordered if not s.is_default]
    if not real or (ctx.router("NO_FEASIBLE_OPTION") and all(s.sim.p_accept == 0 for s in real)):
        reasons.append("NO_FEASIBLE_OPTION")
    m = margin(ordered)
    if m is not None and ctx.router("NEAR_TIE"):
        threshold = max(
            float(ctx.p("near_tie_margin_usd")),
            float(ctx.p("near_tie_margin_pct")) / 100 * abs(ordered[0].score),
        )
        if m < threshold:
            reasons.append("NEAR_TIE")
    high = ctx.router("HIGH_EXPOSURE")
    if high and value_at_risk >= float(
        (high.get("params") or {}).get("min_value_at_risk_usd", ctx.p("high_exposure_usd"))
    ):
        reasons.append("HIGH_EXPOSURE")
    strategic = ctx.router("STRATEGIC_CUSTOMER")
    if strategic and ordered:
        params = strategic.get("params") or {}
        tiers = set(params.get("tiers", ["A"]))
        affected = any(line.get("customer_tier") in tiers for line in pack["affected_order_lines"])
        if affected and (
            not params.get("only_when_shortfall") or ordered[0].sim.tier_a_shortfall_kg > 0
        ):
            reasons.append("STRATEGIC_CUSTOMER")
    if ctx.router("MODEL_OUT_OF_RANGE") and any(
        lot.get("model_validity") == "EXTRAPOLATING" for lot in pack["lots"]
    ):
        reasons.append("MODEL_OUT_OF_RANGE")
    if ctx.router("QUALITATIVE_SIGNAL") and any(
        doc.get("doc_type") in ("INCIDENT_NOTE", "CLAIM_CORRESPONDENCE")
        for doc in pack["documents"]
    ):
        reasons.append("QUALITATIVE_SIGNAL")
    return reasons


def understanding_triggers(pack: dict[str, Any], ctx: EngineContext) -> list[str]:
    """Reasons to send the case to Excursion Forensics before options are scored."""
    reasons = []
    conflict = any(
        (c.get("consistency") or {}).get("verdict") == "CONFLICT"
        for doc in pack["documents"]
        for c in doc["claims"]
    )
    if conflict and ctx.router("EVIDENCE_CONFLICT"):
        reasons.append("EVIDENCE_CONFLICT")
    multi = ctx.router("MULTI_PARTY_LIABILITY")
    if multi:
        cap = float((multi.get("params") or {}).get("max_single_party_share", 0.7))
        for lot in pack["lots"]:
            shares = [
                float(e["excess_life_share"])
                for e in lot["custody_exposure"]
                if e.get("excess_life_share")
            ]
            if shares and max(shares) < cap and len(shares) > 1:
                reasons.append("MULTI_PARTY_LIABILITY")
                break
    if ctx.router("CAUSE_AMBIGUOUS") and any(
        doc.get("doc_type") == "INCIDENT_NOTE" for doc in pack["documents"]
    ):
        reasons.append("CAUSE_AMBIGUOUS")
    return reasons


def why_codes(
    top: Scored, rival_margin: float | None, n_ranked: int, ctx: EngineContext
) -> list[str]:
    codes = ["HIGHEST_RISK_ADJUSTED_NRV"]
    if rival_margin is not None:
        codes.append("MARGIN_ABOVE_THRESHOLD")
    elif n_ranked > 1:
        codes.append("DOMINATES_ALL_ALTERNATIVES")
    codes.append(
        "NO_TIER_A_SHORTFALL" if top.sim.tier_a_shortfall_kg == 0 else "TIER_A_SHORTFALL_PRICED"
    )
    if top.sim.p_accept >= float(ctx.p("min_acceptance_probability")):
        codes.append("MEETS_SPEC_P_ACCEPT")
    if not top.dominated_by:
        codes.append("NOT_DOMINATED")
    return codes
