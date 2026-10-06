"""Scenarios end to end before Snowflake: simulate -> seal a pack -> evaluate.

These pin what the engine *found* in each scenario (docs/demo/scenarios.md, "Engine
findings"). The scenarios fix the fault, never the outcome; when a deliberate engine or
calibration change moves an outcome, update the finding and this test together.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from bbc_engine.context import EngineContext
from bbc_engine.engine import evaluate
from bbc_toolkit import contracts
from blueberrychain.sim import assess
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as w

WORLD = w.load_world()
POLICY = json.loads(
    (Path(__file__).resolve().parents[3] / "snowflake" / "seed" / "policy" / "v1.json").read_text(
        encoding="utf-8"
    )
)
CTX = EngineContext.from_world(WORLD, POLICY)
DEPART = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)


def run(scenario, overrides=None):
    trip = tp.scenario_trip(WORLD, scenario, DEPART, overrides)
    result = tm.simulate(WORLD, trip)
    as_of = assess.opened_at(WORLD, POLICY, trip, result.messages, DEPART)
    assert as_of is not None, "the fault never opened a case"
    pack = assess.assess(WORLD, POLICY, trip, result.messages, as_of)
    return pack, evaluate(pack, CTX, option_id_start=101)


def shares(pack):
    return {
        e["holder_party_id"]: e["excess_life_share"]
        for e in pack["lots"][0]["custody_exposure"]
        if e["excess_life_share"] is not None
    }


@pytest.fixture(scope="module")
def s_a():
    return run("S-A")


@pytest.fixture(scope="module")
def s_b():
    return run("S-B")


@pytest.mark.parametrize("name", ["s_a", "s_b"])
def test_packs_options_and_briefs_are_contract_valid(name, request):
    pack, evaluation = request.getfixturevalue(name)
    assert contracts.validate("evidence_pack.json", pack) == []
    for option in evaluation.options:
        assert contracts.validate("option.json", option) == [], option["label"]
    if evaluation.brief:
        assert contracts.validate("brief.json", evaluation.brief) == []


def test_s_a_detects_in_the_carrier_segment_before_the_junction(s_a):
    pack, _ = s_a
    assert shares(pack)["PARTY-SIERRA"] > 0.9
    assert pack["shipment"]["reefer_state"]["alarms"]  # the unit is still failing at decision time
    window = pack["deadline_inputs"]["windows"][0]
    assert window["kind"] == "REROUTE" and window["closes_at"] > pack["as_of"]
    assert [s["site_id"] for s in pack["inspection_sites"]] == ["SITE-CVDC-TRACY"]


def test_s_a_is_a_near_tie_between_reroute_and_inspection(s_a):
    """Finding: with the compressor still failing, the 1 h hop to Bayline carries a small
    rejection risk and inspecting at the own DC costs a little more - a real trade-off,
    so the Recovery Strategist decides (the design expected a rule decision)."""
    _, evaluation = s_a
    assert evaluation.escalation_reasons == ["NEAR_TIE"]
    top_two = {evaluation.key_of(i) for i in evaluation.draft_brief["comparison"]["ranking"][:2]}
    assert top_two == {"REROUTE:SITE-BAYLINE-SAC:PLAN", "INSPECT:SITE-CVDC-TRACY"}
    assert not evaluation.option("EXPEDITE")["feasible"]
    # Doing nothing is a gamble on the arrival temperature (Summit takes <= 2.0 C), not on shelf
    # life: five days in the cooler left ~15 days against a 10-day spec.
    default = evaluation.option("DEFAULT")["outcome"]
    assert default["operational"]["p_accept"] < POLICY["parameters"]["min_acceptance_probability"]
    assert default["operational"]["sl_at_arrival_days_p10"] > 10
    top = evaluation.option(evaluation.key_of(evaluation.draft_brief["comparison"]["ranking"][0]))
    assert top["outcome"]["financial"]["value_preserved_vs_default_usd"] > 3_000


def test_s_a_short_fault_recovers_and_doing_nothing_wins():
    _, evaluation = run("S-A", {"reefer_compressor_failure": {"duration_h": 1.2}})
    assert evaluation.decision is not None
    assert evaluation.key_of(evaluation.decision["option_id"]) == "DEFAULT"


def test_s_a_hot_day_makes_inspection_the_clear_choice():
    _, evaluation = run("S-A", {"reefer_compressor_failure": {"ambient_c": 35}})
    assert evaluation.decision is not None
    assert evaluation.key_of(evaluation.decision["option_id"]) == "INSPECT:SITE-CVDC-TRACY"
    assert "SPEC_INFEASIBLE" in [
        e["code"] for e in evaluation.option("REROUTE:SITE-BAYLINE-SAC:PLAN")["eliminations"]
    ]


def test_s_b_blames_the_grower_and_escalates_for_the_tier_a_customer(s_b):
    pack, evaluation = s_b
    assert shares(pack)["PARTY-EMERALD-RIDGE"] > 0.9
    assert {"MODEL_OUT_OF_RANGE", "STRATEGIC_CUSTOMER"} <= set(evaluation.escalation_reasons)
    assert evaluation.decision is None
    # The grower is charged through settlement (D2), so no carrier claim notice is attached.
    assert all(a["action"] == "NONE" for o in evaluation.options for a in o["bundle"]["financial"])


def test_s_a_mild_fault_is_the_designed_rule_decided_reroute():
    _, evaluation = run("S-A", {"reefer_compressor_failure": {"ambient_c": 18}})
    assert evaluation.decision is not None
    assert evaluation.key_of(evaluation.decision["option_id"]) == "REROUTE:SITE-BAYLINE-SAC:PLAN"


def test_s_a_mildest_fault_is_detected_too_late_to_divert():
    """38 min to the junction < dispatch lead + approval buffer: the window closes."""
    _, evaluation = run("S-A", {"reefer_compressor_failure": {"ambient_c": 12}})
    for option in evaluation.options:
        if option["bundle"]["lots"][0]["disposition"] in ("REROUTE", "DOWNGRADE", "INSPECT"):
            assert "WINDOW_CLOSED" in [e["code"] for e in option["eliminations"]]
    assert evaluation.escalation_reasons == ["STRATEGIC_CUSTOMER"]
