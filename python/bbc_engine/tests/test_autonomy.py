"""Effective autonomy level and approvers (plan Phase 12), on policy v1."""

import copy

import pytest
from bbc_engine.autonomy import Action, authorize, combine, option_metrics

CALM = {  # every metric inside its L3 threshold
    "action_value_usd": 2_000,
    "value_at_risk_usd": 5_000,
    "tier_a_lines_affected": 0,
    "p_otif_shortfall": 0.0,
    "lines_affected": 1,
    "replacement_share_of_site_atp": 0.1,
    "stockout_risk_lines": 0,
    "p_reject": 0.01,
    "reversibility_rank": 0,
    "food_safety_flag": False,
    "confidence_rank": 0,
    "data_age_min": 5,
    "coverage_shortfall_pct": 4,
    "unresolved_conflicts": 0,
    "snapshot_age_h": 2,
}


def act(action_type="SO_CHANGE", decider="RULE", value=2_000, metrics=None, **kw):
    return Action(action_type, "D1", decider, value, {**CALM, **(metrics or {})}, **kw)


def with_params(policy, **params):
    out = copy.deepcopy(policy)
    out["parameters"].update(params)
    return out


def test_low_risk_reversible_action_runs_automatically(policy):
    a = authorize(act(), policy)
    assert (a.outcome, a.level, a.required_roles) == ("AUTO", 4, ())
    assert a.matched_rules == ("DR-99",)


def test_protective_actions_skip_the_thresholds(policy):
    a = authorize(
        act("CLAIM_NOTICE", metrics={"value_at_risk_usd": 90_000, "reversibility_rank": 1}), policy
    )
    assert (a.outcome, a.level) == ("AUTO", 3)
    assert a.dimensions == ()


def test_worked_example_bundle_needs_sales_and_quality(worked, fixture_pack, policy):
    option = worked.option("REROUTE:SITE-BAYLINE-SAC:PLAN")
    var = 47_040 - worked.option("DEFAULT")["outcome"]["financial"]["expected_nrv_usd"]
    revenue = option["outcome"]["financial"]["expected_revenue_usd"]
    results = []
    for action_type, value in (
        ("REROUTE", revenue),
        ("REPLACEMENT_ALLOCATION", 4200 * 11.2),
        ("CLAIM_NOTICE", 0),
    ):
        metrics = option_metrics(option, fixture_pack, action_type, policy, value_at_risk_usd=var)
        results.append(
            authorize(act(action_type, value=value, metrics=metrics, customer_tiers=("A",)), policy)
        )
    reroute, allocation, notice = results
    assert reroute.outcome == "APPROVE"
    assert set(reroute.required_roles) == {
        "BBC_SALES_MGR",
        "BBC_QUALITY_MGR",
    }  # DR-04 + compensatable
    assert "DR-04" in reroute.matched_rules
    assert allocation.outcome == "APPROVE" and "DR-05" in allocation.matched_rules
    assert notice.outcome == "AUTO"
    bundle = combine(results)
    assert bundle.outcome == "APPROVE"
    assert set(bundle.required_roles) == {"BBC_SALES_MGR", "BBC_QUALITY_MGR"}


def test_food_safety_denies_a_sale_but_allows_disposal_with_quality(policy):
    flagged = {"food_safety_flag": True}
    assert (
        authorize(act("REROUTE", metrics=flagged, food_safety_flag=True), policy).outcome == "DENY"
    )
    dispose = authorize(act("DISPOSE", metrics=flagged, food_safety_flag=True), policy)
    assert dispose.outcome == "APPROVE" and "BBC_QUALITY_MGR" in dispose.required_roles


def test_irreversible_is_never_automatic(policy):
    a = authorize(act("DISPOSE", metrics={"reversibility_rank": 2}), policy)
    assert a.outcome == "APPROVE"


def test_ceiling_and_kill_switches(policy):
    assert authorize(act(), with_params(policy, autonomy_ceiling=2)).outcome == "HUMAN_INITIATE"
    assert authorize(act(), with_params(policy, autonomy_ceiling=0)).outcome == "OBSERVE_ONLY"
    shadow = authorize(act(), with_params(policy, shadow_mode=True))
    assert shadow.outcome == "AUTO" and shadow.shadow
    assert not authorize(act(), with_params(policy, dispatch_enabled=False)).dispatch


def test_the_fallback_hold_runs_even_below_l3(policy):
    off = with_params(policy, autonomy_ceiling=0)
    assert (
        authorize(act("STOCK_BLOCK", decider="FALLBACK", is_fallback=True), off).outcome == "AUTO"
    )
    disabled = with_params(off, fallback_enabled=False)
    assert (
        authorize(act("STOCK_BLOCK", decider="FALLBACK", is_fallback=True), disabled).outcome
        == "DENY"
    )


def test_agent_decisions_need_an_auditor_pass_and_approval_above_10k(policy):
    unaudited = authorize(act(decider="AGENT", value=2_000), policy)
    assert unaudited.outcome == "HUMAN_INITIATE" and unaudited.level == 2
    big = authorize(act(decider="AGENT", value=40_000, auditor_pass=True), policy)
    assert big.outcome == "APPROVE" and "DR-08" in big.matched_rules
    assert "BBC_QUALITY_MGR" in big.required_roles
    small = authorize(act(decider="AGENT", value=2_000, auditor_pass=True), policy)
    assert small.outcome == "AUTO"


def test_data_quality_caps_the_level(policy):
    stale = authorize(act(metrics={"data_age_min": 400}), policy)
    assert (stale.outcome, stale.level) == ("OBSERVE_ONLY", 1)
    aging = authorize(act(metrics={"data_age_min": 200}), policy)
    assert (aging.outcome, aging.level) == ("HUMAN_INITIATE", 2)
    low = authorize(act(metrics={"confidence_rank": 2}), policy)
    assert low.level == 2


def test_large_amounts_need_two_approvers_with_different_roles(policy):
    a = authorize(act(metrics={"action_value_usd": 250_000}), policy)
    assert a.outcome == "APPROVE" and a.dual_approval
    assert {"BBC_FINANCE_MGR", "BBC_QUALITY_MGR"} <= set(a.required_roles)


def test_missing_metrics_fail_loudly(policy):
    with pytest.raises(ValueError, match="p_reject"):
        authorize(
            Action(
                "SO_CHANGE", "D1", "RULE", 0, {k: v for k, v in CALM.items() if k != "p_reject"}
            ),
            policy,
        )


def test_unknown_action_types_are_denied(policy):
    assert authorize(act("TELEPORT"), policy).outcome == "DENY"


def test_a_shadow_rule_records_without_dispatching(policy):
    shadowed = copy.deepcopy(policy)
    shadowed["decision_rights"].insert(
        0,
        {
            "rule_id": "DR-00",
            "priority": 1,
            "conditions": {"action_types": ["SO_CHANGE"]},
            "outcome": "SHADOW",
            "required_roles": [],
            "note": "trial",
        },
    )
    a = authorize(act(), shadowed)
    assert a.shadow and "DR-00" in a.matched_rules
    assert not authorize(act("STOCK_BLOCK"), shadowed).shadow
