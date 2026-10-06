"""Golden test: the plan's Phase 11 worked example, computed by the engine.

Lot L-A, 4,200 kg organic, planned value $47,040, about 9.0 +/- 0.8 days of shelf life
left; the club customer (tier A) needs 10 days at receipt and the truck is 22 h out; the
carrier holds 82% of the excess shelf-life loss. The worked example's verdict: doing
nothing is rejected at receipt; re-routing to the regional buyer and refilling the club
order from DC stock is rule-decided; expediting is SPEC_INFEASIBLE.

``golden/worked_example.json`` pins the exact numbers (the replay guarantee). After an
intended engine change, regenerate it with ``BBC_UPDATE_GOLDEN=1 uv run pytest`` and
review the diff.
"""

import json
import os
from pathlib import Path

from bbc_engine.engine import evaluate

GOLDEN = Path(__file__).parent / "golden" / "worked_example.json"


def _key(evaluation, option):
    return evaluation.key_of(option["option_id"])


def test_rule_decides_reroute_with_refill(worked):
    assert worked.escalation_reasons == []
    assert worked.understanding_triggers == []
    decision = worked.decision
    assert decision["decided_by"] == "RULE"
    assert _key(worked, {"option_id": decision["option_id"]}) == "REROUTE:SITE-BAYLINE-SAC:PLAN"
    chosen = worked.option("REROUTE:SITE-BAYLINE-SAC:PLAN")
    assert chosen["bundle"]["order_recovery"] == [
        {
            "order_line_id": "SO-6001-10",
            "action": "FILL_FROM",
            "replacement_lot_id": "L-CV-0912",
            "from_site_id": "SITE-CVDC-TRACY",
            "kg": 4200.0,
            "repromise_at": None,
        }
    ]
    assert chosen["outcome"]["operational"]["p_accept"] >= 0.99
    assert chosen["outcome"]["customer"]["tier_a_shortfall_kg"] == 0
    assert "DOMINATES_ALL_ALTERNATIVES" in decision["why_structured"]
    assert worked.brief["recommendation"] == decision


def test_doing_nothing_is_rejected_at_receipt(worked):
    default = worked.option("DEFAULT")
    op, fin = default["outcome"]["operational"], default["outcome"]["financial"]
    assert default["feasible"] and default["eliminations"] == []
    assert op["p_accept"] < 0.05
    assert op["sl_at_arrival_days_p50"] < 10  # below the club spec
    assert 20_000 < fin["expected_nrv_usd"] < 30_000  # processor salvage + a contested claim
    assert fin["expected_recovery_usd"] > 0
    assert fin["expected_penalties_usd"] > 0


def test_expedite_is_spec_infeasible(worked):
    expedite = worked.option("EXPEDITE")
    assert not expedite["feasible"]
    assert [e["code"] for e in expedite["eliminations"]] == ["SPEC_INFEASIBLE"]
    assert "10-day spec" in expedite["eliminations"][0]["detail"]
    assert expedite["score"]["rank"] is None


def test_ranking_and_value_preserved(worked):
    ranking = [worked.key_of(i) for i in worked.draft_brief["comparison"]["ranking"]]
    assert ranking == [
        "REROUTE:SITE-BAYLINE-SAC:PLAN",
        "INSPECT:SITE-CVDC-TRACY",
        "REROUTE:SITE-BAYLINE-SAC:SHORT",
        "DOWNGRADE:SITE-VFP-FRESNO:PLAN",
        "DOWNGRADE:SITE-VFP-FRESNO:SHORT",
        "HOLD",
        "DEFAULT",
    ]
    preserved = worked.option("REROUTE:SITE-BAYLINE-SAC:PLAN")["outcome"]["financial"][
        "value_preserved_vs_default_usd"
    ]
    assert 15_000 < preserved < 25_000  # the worked example: about +$19.6k
    downgrade = worked.option("DOWNGRADE:SITE-VFP-FRESNO:PLAN")["outcome"]["financial"][
        "expected_nrv_usd"
    ]
    default = worked.option("DEFAULT")["outcome"]["financial"]["expected_nrv_usd"]
    assert (
        default
        < downgrade
        < worked.option("REROUTE:SITE-BAYLINE-SAC:PLAN")["outcome"]["financial"]["expected_nrv_usd"]
    )


def test_inspection_keeps_onward_options_but_costs_more(worked):
    """Plan erratum: inspecting at the own DC does not lose the re-route (the DC has lanes to
    every buyer); it costs the inspection, handling and the waiting truck, so it ranks second
    and is dominated by the direct re-route."""
    inspect = worked.option("INSPECT:SITE-CVDC-TRACY")
    reroute = worked.option("REROUTE:SITE-BAYLINE-SAC:PLAN")
    assert inspect["feasible"] and inspect["is_fallback"]
    assert inspect["outcome"]["financial"]["costs"]["inspection_usd"] > 0
    assert reroute["option_id"] in inspect["score"]["dominated_by"]


def test_active_reefer_fault_rules_out_the_long_reroute(fixture_pack, ctx):
    """The fixture as written: the compressor alarm is still on. Six more hours in a failing
    trailer make Bayline's 4.4 C arrival limit a coin flip, so the 1.5 h hop to the own DC for
    inspection wins - the engine's call, not the worked example's."""
    evaluation = evaluate(fixture_pack, ctx, option_id_start=101)
    reroute = evaluation.option("REROUTE:SITE-BAYLINE-SAC:PLAN")
    assert [e["code"] for e in reroute["eliminations"]] == ["SPEC_INFEASIBLE"]
    assert evaluation.decision is not None
    assert evaluation.key_of(evaluation.decision["option_id"]) == "INSPECT:SITE-CVDC-TRACY"


def _snapshot(evaluation):
    rows = []
    for option in evaluation.options:
        f = option["outcome"]["financial"]
        rows.append(
            {
                "key": evaluation.key_of(option["option_id"]),
                "option_id": option["option_id"],
                "feasible": option["feasible"],
                "rank": option["score"]["rank"],
                "risk_adjusted_usd": option["score"]["risk_adjusted_usd"],
                "expected_nrv_usd": f["expected_nrv_usd"],
                "nrv_p10_usd": f["nrv_p10_usd"],
                "nrv_p90_usd": f["nrv_p90_usd"],
                "expected_recovery_usd": f["expected_recovery_usd"],
                "p_accept": option["outcome"]["operational"]["p_accept"],
                "seed": option["provenance"]["seed"],
            }
        )
    return {
        "decision": evaluation.decision["option_id"] if evaluation.decision else None,
        "brief_hash": evaluation.brief["brief_hash"] if evaluation.brief else None,
        "options": rows,
    }


def test_numbers_match_the_golden_file(worked):
    snapshot = _snapshot(worked)
    if os.environ.get("BBC_UPDATE_GOLDEN"):
        GOLDEN.parent.mkdir(exist_ok=True)
        text = json.dumps(snapshot, indent=2) + "\n"
        GOLDEN.write_text(text, encoding="utf-8", newline="\n")
    assert GOLDEN.exists(), "no golden file: run with BBC_UPDATE_GOLDEN=1 and review it"
    assert snapshot == json.loads(GOLDEN.read_text(encoding="utf-8"))
