"""Order recovery: fill, repromise or short each affected line."""

from datetime import UTC, datetime

from bbc_engine import solver

AS_OF = datetime(2026, 10, 6, 8, 0, tzinfo=UTC)


def line(
    order_line_id="SO-1-10", kg=4200, tier="A", organic=True, due="2026-10-07T10:00:00Z", min_sl=10
):
    return {
        "order_line_id": order_line_id,
        "customer_party_id": "PARTY-SUMMIT",
        "customer_tier": tier,
        "product_id": "BB-EMERALD-ORG-12x6",
        "organic_required": organic,
        "kg": kg,
        "price_usd_per_kg": 11.2,
        "requested_delivery_at": due,
        "ship_to_site_id": "SITE-SUMMIT-SLC",
        "min_shelf_life_days_at_receipt": min_sl,
        "penalty_terms": {"otif_penalty_pct": 3},
    }


def stock(
    lot_id="L-CV-1",
    kg=38000,
    sl=14.2,
    organic=True,
    site="SITE-CVDC-TRACY",
    product="BB-EMERALD-ORG-12x6",
):
    return {
        "lot_id": lot_id,
        "site_id": site,
        "product_id": product,
        "organic": organic,
        "kg_available": kg,
        "remaining_shelf_life_days": sl,
        "snapshot_at": "2026-10-06T06:00:00Z",
    }


def test_fills_from_dc_stock_on_time(ctx):
    plan = solver.solve([line()], [stock()], ctx, AS_OF)
    [p] = plan.lines
    assert (p.action, p.replacement_lot_id, p.from_site_id, p.on_time) == (
        "FILL_FROM",
        "L-CV-1",
        "SITE-CVDC-TRACY",
        True,
    )
    # transfer fee + part-load freight (4,200 of 21,000 kg) + handling
    assert p.cost_usd == round(400 + 3500 * 4200 / 21000 + 4200 * 0.05, 2)
    assert plan.tier_a_shortfall_kg == 0 and plan.penalty_usd == 0


def test_conventional_fruit_never_fills_an_organic_line(ctx):
    plan = solver.solve([line()], [stock(organic=False)], ctx, AS_OF)
    assert [p.action for p in plan.lines] == ["SHORT"]
    assert plan.tier_a_shortfall_kg == 4200


def test_stock_that_would_arrive_below_spec_is_not_used(ctx):
    plan = solver.solve(
        [line()], [stock(sl=10.2)], ctx, AS_OF
    )  # 16 h + 2 h of transit takes it under 10 days
    assert [p.action for p in plan.lines] == ["SHORT"]


def test_late_fill_is_a_repromise_with_the_otif_penalty(ctx):
    plan = solver.solve([line(due="2026-10-06T12:00:00Z")], [stock()], ctx, AS_OF)
    [p] = plan.lines
    assert p.action == "REPROMISE" and p.repromise_at is not None
    assert p.penalty_usd == round(4200 * 11.2 * 0.03, 2)


def test_two_lines_cannot_share_more_stock_than_exists(ctx):
    lines = [line("SO-1-10", kg=3000, tier="A"), line("SO-2-10", kg=3000, tier="B")]
    plan = solver.solve(lines, [stock(kg=4000)], ctx, AS_OF)
    actions = {p.order_line_id: p.action for p in plan.lines}
    assert sorted(actions.values()) == ["FILL_FROM", "SHORT"]
    assert actions["SO-1-10"] == "FILL_FROM"  # the tier-A weight decides who is served


def test_wrong_product_or_too_little_stock_is_skipped(ctx):
    assert solver.fill_candidates(line(), [stock(product="BB-DUKE-ORG-12x6")], ctx, AS_OF) == []
    assert solver.fill_candidates(line(), [stock(kg=100)], ctx, AS_OF) == []
    assert solver.solve([], [stock()], ctx, AS_OF).lines == []


def test_all_short(ctx):
    plan = solver.all_short([line(), line("SO-2-10", tier="B")])
    assert [p.action for p in plan.lines] == ["SHORT", "SHORT"]
    assert plan.tier_a_shortfall_kg == 4200
    assert plan.penalty_usd == round(2 * 4200 * 11.2 * 0.03, 2)
