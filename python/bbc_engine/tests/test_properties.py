"""Invariants every evaluation must satisfy, on the worked example and on variants of it.

Reduced sample counts where only structure matters (the numbers are not under test).
"""

import copy
import dataclasses
import json
from datetime import datetime, timedelta

import pytest
from bbc_engine import physics
from bbc_engine.engine import evaluate, finalize_brief
from bbc_toolkit import contracts

FAST = 300


def _eval(pack, ctx, **kw):
    return evaluate(pack, ctx, option_id_start=101, samples=kw.pop("samples", FAST), **kw)


def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


# ---------------------------------------------------------------- reproducibility


def test_same_inputs_give_identical_numbers(pack, ctx, worked):
    again = evaluate(pack, ctx, option_id_start=101)
    assert json.dumps(again.options, sort_keys=True) == json.dumps(worked.options, sort_keys=True)
    assert again.brief["brief_hash"] == worked.brief["brief_hash"]


def test_a_new_pack_revision_reseeds(pack, ctx):
    first = _eval(pack, ctx)
    revised = copy.deepcopy(pack)
    revised["revision"] = 2
    second = _eval(revised, ctx)
    seeds = {o["option_id"]: o["provenance"]["seed"] for o in first.options}
    assert all(o["provenance"]["seed"] != seeds[o["option_id"]] for o in second.options)
    assert all(o["option_set_rev"] == 2 for o in second.options)


def test_option_ids_follow_the_allocated_range(pack, ctx):
    evaluation = evaluate(pack, ctx, option_id_start=5000, samples=FAST)
    assert [o["option_id"] for o in evaluation.options] == [
        f"OPT-{5000 + i:08d}" for i in range(len(evaluation.options))
    ]


# ---------------------------------------------------------------- contracts


def test_every_option_and_the_brief_are_contract_valid(worked):
    for option in worked.options:
        assert contracts.validate("option.json", option) == [], option["label"]
    assert contracts.validate("brief.json", worked.brief) == []


def test_an_agent_choice_finalizes_a_valid_brief(pack, ctx):
    evaluation = _eval(pack, ctx, finding=None)
    choice = evaluation.option("INSPECT:SITE-CVDC-TRACY")
    brief = finalize_brief(
        evaluation.draft_brief,
        {
            "option_id": choice["option_id"],
            "decided_by": "AGENT",
            "decider_id": "RECOVERY_STRATEGIST@1",
            "why_structured": ["REVERSIBLE_UNDER_UNCERTAINTY"],
            "narrative": "Inspect first.",
        },
    )
    assert contracts.validate("brief.json", brief) == []
    assert brief["brief_hash"] != evaluation.brief["brief_hash"]


# ---------------------------------------------------------------- structural invariants


def test_default_and_fallback_are_always_present(worked):
    defaults = [o for o in worked.options if o["is_default"]]
    fallbacks = [o for o in worked.options if o["is_fallback"]]
    assert len(defaults) == 1 and len(fallbacks) == 1
    assert defaults[0]["feasible"] and defaults[0]["score"]["rank"] is not None
    assert worked.draft_brief["do_nothing"]["option_id"] == defaults[0]["option_id"]


def test_infeasible_options_are_never_ranked_or_chosen(worked):
    ranking = worked.draft_brief["comparison"]["ranking"]
    for option in worked.options:
        if not option["feasible"]:
            assert option["eliminations"] and option["score"]["rank"] is None
            assert option["option_id"] not in ranking
            assert option["option_id"] not in {
                r["option_id"] for r in worked.draft_brief["value_table"]
            }
    by_id = {o["option_id"]: o for o in worked.options}
    assert all(by_id[i]["feasible"] for i in ranking)
    assert [by_id[i]["score"]["rank"] for i in ranking] == list(range(1, len(ranking) + 1))
    scores = [by_id[i]["score"]["risk_adjusted_usd"] for i in ranking]
    assert scores == sorted(scores, reverse=True)
    assert by_id[worked.decision["option_id"]]["feasible"]


def test_nrv_formula_parity(worked):
    """NRV = revenue - costs - penalties + recovery, for every option (rounded components)."""
    default_nrv = worked.option("DEFAULT")["outcome"]["financial"]["expected_nrv_usd"]
    for option in worked.options:
        f = option["outcome"]["financial"]
        costs = sum(f["costs"].values())
        assert f["expected_nrv_usd"] == pytest.approx(
            f["expected_revenue_usd"]
            - costs
            - f["expected_penalties_usd"]
            + f["expected_recovery_usd"],
            abs=0.05,
        )
        assert option["outcome"]["recovery_cost_usd"] == pytest.approx(costs, abs=0.01)
        assert f["expected_loss_usd"] == pytest.approx(47_040 - f["expected_nrv_usd"], abs=0.01)
        assert f["value_preserved_vs_default_usd"] == pytest.approx(
            f["expected_nrv_usd"] - default_nrv, abs=0.01
        )
        assert f["nrv_p10_usd"] <= f["nrv_p90_usd"]


def test_recovery_is_bounded_by_the_carrier_cap(worked, ctx):
    cap = ctx.contract("PARTY-SIERRA", "CARRIER_TRANSPORT")["liability_cap_usd"]
    for option in worked.options:
        assert 0 <= option["outcome"]["financial"]["expected_recovery_usd"] <= cap


def test_claim_notice_rides_on_every_recovery_option(worked):
    for option in worked.options:
        actions = [a["action"] for a in option["bundle"]["financial"]]
        if option["is_default"]:
            assert actions == ["NONE"]
        else:
            assert actions == ["CLAIM_NOTICE"]
            assert option["bundle"]["financial"][0]["counterparty_party_id"] == "PARTY-SIERRA"


# ---------------------------------------------------------------- hard constraints (E3)


def test_food_safety_leaves_only_hold_inspect_or_dispose(pack, ctx):
    flagged = copy.deepcopy(pack)
    flagged["lots"][0]["food_safety_flag"] = True
    evaluation = _eval(flagged, ctx)
    feasible = {
        o["bundle"]["lots"][0]["disposition"]
        for o in evaluation.options
        if o["feasible"] and not o["is_default"]
    }
    assert feasible <= {"INSPECT", "HOLD", "DISPOSE"}
    assert "DISPOSE" in {o["bundle"]["lots"][0]["disposition"] for o in evaluation.options}
    assert all(o["outcome"]["risk"]["food_safety_flag"] for o in evaluation.options)


def test_window_closed_with_the_approval_buffer(pack, ctx):
    """Dispatch lead (15 min) + approval buffer (30 min) > 40 min left: diversions are gone."""
    late = copy.deepcopy(pack)
    closes = _ts(late["deadline_inputs"]["windows"][0]["closes_at"])
    late["as_of"] = _iso(closes - timedelta(minutes=40))
    evaluation = _eval(late, ctx)
    for option in evaluation.options:
        if option["bundle"]["lots"][0]["disposition"] in ("REROUTE", "DOWNGRADE", "INSPECT"):
            assert "WINDOW_CLOSED" in [e["code"] for e in option["eliminations"]], option["label"]


def test_capacity(pack, ctx):
    small = copy.deepcopy(pack)
    small["candidate_destinations"][0]["capacity_kg"] = 1000
    evaluation = _eval(small, ctx)
    assert "CAPACITY" in [
        e["code"] for e in evaluation.option("REROUTE:SITE-BAYLINE-SAC:PLAN")["eliminations"]
    ]


def test_contract_prohibits_diversion(pack, ctx):
    contracts_ = [
        dict(c, terms={**c["terms"], "diversion_allowed": False})
        if c["party_id"] == "PARTY-SUMMIT"
        else c
        for c in ctx.contracts
    ]
    strict = dataclasses.replace(ctx, contracts=contracts_)
    evaluation = _eval(pack, strict)
    for option in evaluation.options:
        diverts = option["bundle"]["order_recovery"][0]["action"] != "KEEP"
        assert ("CONTRACT_PROHIBITS" in [e["code"] for e in option["eliminations"]]) == diverts


def test_the_default_is_never_eliminated(pack, ctx):
    hopeless = copy.deepcopy(pack)
    hopeless["lots"][0]["food_safety_flag"] = True
    hopeless["lots"][0]["values"][0]["value"] = 0.5
    evaluation = _eval(hopeless, ctx)
    default = evaluation.option("DEFAULT")
    assert default["feasible"] and default["eliminations"] == []


# ---------------------------------------------------------------- routing (E8)


def test_extrapolating_model_escalates(pack, ctx):
    shaky = copy.deepcopy(pack)
    shaky["lots"][0]["model_validity"] = "EXTRAPOLATING"
    evaluation = _eval(shaky, ctx)
    assert "MODEL_OUT_OF_RANGE" in evaluation.escalation_reasons
    assert evaluation.decision is None and evaluation.brief is None
    assert (
        evaluation.draft_brief["comparison"]["escalation_reasons"] == evaluation.escalation_reasons
    )


def test_high_exposure_threshold_comes_from_the_router_rule(pack, ctx):
    rules = [
        dict(r, params={"min_value_at_risk_usd": 1000}) if r["trigger"] == "HIGH_EXPOSURE" else r
        for r in ctx.router_rules
    ]
    evaluation = _eval(pack, dataclasses.replace(ctx, router_rules=rules))
    assert evaluation.escalation_reasons == ["HIGH_EXPOSURE"]


def test_a_dominating_top_option_is_never_a_near_tie(pack, ctx):
    """Even with a margin threshold larger than any gap: dominated rivals are no trade-off."""
    params = {**ctx.params, "near_tie_margin_pct": 60, "near_tie_margin_usd": 100_000}
    evaluation = _eval(pack, dataclasses.replace(ctx, params=params))
    assert "NEAR_TIE" not in evaluation.escalation_reasons
    assert (
        evaluation.draft_brief["comparison"]["margin_top2_usd"] > 0
    )  # the plain gap is still reported


def test_incident_notes_and_conflicts_trigger_forensics(pack, ctx):
    noted = copy.deepcopy(pack)
    noted["documents"][0]["claims"][0]["consistency"]["verdict"] = "CONFLICT"
    noted["documents"].append(
        {
            "doc_id": "DOC-NOTE-1",
            "doc_type": "INCIDENT_NOTE",
            "sha256": "0" * 64,
            "received_at": noted["as_of"],
            "claims": [],
        }
    )
    evaluation = _eval(noted, ctx)
    assert set(evaluation.understanding_triggers) == {"EVIDENCE_CONFLICT", "CAUSE_AMBIGUOUS"}
    assert "QUALITATIVE_SIGNAL" in evaluation.escalation_reasons
    assert evaluation.decision is None


def test_shared_liability_triggers_forensics(pack, ctx):
    split = copy.deepcopy(pack)
    for e, share in zip(split["lots"][0]["custody_exposure"], (0.55, 0.45), strict=True):
        e["excess_life_share"] = share
    assert _eval(split, ctx).understanding_triggers == ["MULTI_PARTY_LIABILITY"]


def test_a_confident_finding_raises_expected_recovery(pack, ctx):
    base = _eval(pack, ctx)
    found = _eval(pack, ctx, finding={"confidence": "HIGH"})
    comparison = found.draft_brief["comparison"]
    assert comparison["p_liab_with_finding"] > comparison["p_liab_attribution_only"]
    key = "DOWNGRADE:SITE-VFP-FRESNO:PLAN"
    assert (
        found.option(key)["outcome"]["financial"]["expected_recovery_usd"]
        > base.option(key)["outcome"]["financial"]["expected_recovery_usd"]
    )


def test_missing_bol_setpoint_weakens_the_carrier_claim(pack, ctx):
    no_bol = copy.deepcopy(pack)
    no_bol["shipment"]["bol_setpoint_c"] = None
    key = "DOWNGRADE:SITE-VFP-FRESNO:PLAN"
    weak = _eval(no_bol, ctx).option(key)["outcome"]["financial"]["expected_recovery_usd"]
    strong = _eval(pack, ctx).option(key)["outcome"]["financial"]["expected_recovery_usd"]
    assert weak < strong * 0.5


def test_projection_matches_the_physics_rate():
    """A steady leg consumes exactly rate(T) reference hours per hour (the UDF's form)."""
    from bbc_engine.projection import Leg, at_setpoint_days, run_legs

    consumed, temp = run_legs(4.0, [Leg(10, 4.0, 5.0)], 0.0, 3.0)
    assert temp == pytest.approx(4.0)
    assert consumed == pytest.approx(10 * physics.rate(4.0, 0.0, 3.0))
    assert at_setpoint_days(9.0, 24, 4.0, 0.0, 3.0) == pytest.approx(
        9.0 - physics.rate(4.0, 0.0, 3.0)
    )
