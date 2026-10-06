"""Ranking, dominance and the near-tie rule on hand-made outcomes."""

import dataclasses

import pytest
from bbc_engine.rank import (
    Scored,
    dominates,
    margin,
    rank,
    recommendation_triggers,
    weakly_dominates,
)
from bbc_engine.simulate import Simulated

PACK = {
    "affected_order_lines": [{"customer_tier": "B"}],
    "lots": [{"model_validity": "IN_RANGE"}],
    "documents": [],
}


def sim(e, tail=None, p10=None, p_reject=0.0, tier_a=0.0, confidence=2):
    return Simulated(
        {},
        e,
        e if p10 is None else p10,
        e,
        e if tail is None else tail,
        1 - p_reject,
        p_reject,
        tier_a,
        confidence,
    )


def scored(key, s, feasible=True, default=False):
    return Scored(key, s, feasible=feasible, is_default=default)


def test_score_is_mean_minus_tail_risk_minus_tier_a(ctx):
    lam = ctx.p("risk_aversion_lambda")
    kappa = ctx.p("tier_a_weight_kappa_usd_per_kg")
    ordered = rank([scored("A", sim(40_000, tail=30_000, tier_a=100))], ctx)
    assert ordered[0].score == pytest.approx(40_000 - lam * 10_000 - kappa * 100)


def test_dominance():
    a, b = scored("A", sim(10, p_reject=0.0)), scored("B", sim(9, p_reject=0.1))
    assert dominates(a, b) and not dominates(b, a)
    same = scored("C", sim(10))
    assert weakly_dominates(a, same) and not dominates(a, same)
    trade = scored("D", sim(12, p_reject=0.2))  # more value, more risk: a real trade-off
    assert not dominates(a, trade) and not dominates(trade, a)


def test_infeasible_options_are_not_ranked(ctx):
    items = [scored("A", sim(10)), scored("B", sim(99), feasible=False)]
    ordered = rank(items, ctx)
    assert [s.key for s in ordered] == ["A"]
    assert items[1].rank is None


def test_margin_skips_dominated_rivals(ctx):
    trade = sim(51_000, tail=40_000, p10=40_000, p_reject=0.05)  # more value, fatter downside
    ordered = rank(
        [scored("TOP", sim(50_000)), scored("DOM", sim(49_900)), scored("TRADE", trade)], ctx
    )
    assert [s.key for s in ordered] == ["TOP", "DOM", "TRADE"]
    assert margin(ordered) == pytest.approx(ordered[0].score - ordered[2].score)


def test_near_tie_against_a_real_alternative_escalates(ctx):
    close = rank(
        [
            scored("A", sim(45_000)),
            scored("B", sim(46_000, tail=44_000, p10=44_000, p_reject=0.02)),
        ],
        ctx,
    )
    assert "NEAR_TIE" in recommendation_triggers(close, 10_000, PACK, ctx)
    wide = rank(
        [scored("A", sim(45_000)), scored("B", sim(30_000, p_reject=0.02, p10=50_000))], ctx
    )
    assert "NEAR_TIE" not in recommendation_triggers(wide, 10_000, PACK, ctx)


def test_no_feasible_option_beyond_the_default(ctx):
    ordered = rank(
        [scored("DEFAULT", sim(20_000), default=True), scored("X", sim(1), feasible=False)], ctx
    )
    assert "NO_FEASIBLE_OPTION" in recommendation_triggers(ordered, 10_000, PACK, ctx)


def test_strategic_customer_only_when_short(ctx):
    pack = {**PACK, "affected_order_lines": [{"customer_tier": "A"}]}
    fine = rank([scored("A", sim(45_000))], ctx)
    assert "STRATEGIC_CUSTOMER" not in recommendation_triggers(fine, 10_000, pack, ctx)
    short = rank([scored("A", sim(45_000, tier_a=4200))], ctx)
    assert "STRATEGIC_CUSTOMER" in recommendation_triggers(short, 10_000, pack, ctx)


def test_disabled_router_rules_do_not_fire(ctx):
    rules = [
        dict(r, enabled=False) if r["trigger"] == "HIGH_EXPOSURE" else r for r in ctx.router_rules
    ]
    quiet = dataclasses.replace(ctx, router_rules=rules)
    ordered = rank([scored("A", sim(45_000))], quiet)
    assert "HIGH_EXPOSURE" not in recommendation_triggers(ordered, 10**9, PACK, quiet)
    assert "HIGH_EXPOSURE" in recommendation_triggers(ordered, 10**9, PACK, ctx)
