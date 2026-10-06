"""The semantic model: structure, rendered DDL, and governed definition hashes."""

import copy
import json

import pytest
from blueberrychain import semantic

MODEL = semantic.load_model()


def test_model_is_well_formed():
    assert semantic.model_problems(MODEL) == []


def test_rendered_view_has_every_part():
    sql = semantic.render_sql(MODEL)
    assert "CREATE OR REPLACE SEMANTIC VIEW BBC_OS.SEM.EXCURSION_RECOVERY" in sql
    for t in MODEL["tables"]:
        assert f"    {t['alias']} AS {t['table']} PRIMARY KEY" in sql
    assert (
        "inventory.quality_adjusted_atp_kg NON ADDITIVE BY (inventory.snapshot_at DESC) AS SUM("
        in sql
    )
    assert "lot''s value" in sql  # quotes in comments are escaped
    for view in MODEL["views"]:
        assert f"CREATE OR REPLACE VIEW BBC_OS.SEM.{view} AS" in sql


def test_policy_seed_carries_the_current_hashes():
    policy = json.loads(semantic.POLICY.read_text(encoding="utf-8"))
    assert semantic.policy_hash_problems(policy, MODEL) == []


def _metric(model, registry):
    return next(m for m in model["metrics"] if m.get("registry") == registry)


def test_changing_what_a_metric_computes_changes_its_hash():
    base = semantic.definition_hashes(MODEL)
    changed = copy.deepcopy(MODEL)
    _metric(changed, "REMAINING_SHELF_LIFE_DAYS")["expr"] = "AVG(lot_thermal.remaining_days)"
    assert (
        semantic.definition_hashes(changed)["REMAINING_SHELF_LIFE_DAYS"]
        != base["REMAINING_SHELF_LIFE_DAYS"]
    )
    # A fact the metric reads counts too.
    fact = next(f for f in changed["facts"] if f["name"] == "inventory.atp_kg")
    fact["expr"] = "inventory.unrestricted_kg"
    assert (
        semantic.definition_hashes(changed)["QUALITY_ADJUSTED_ATP_KG"]
        != base["QUALITY_ADJUSTED_ATP_KG"]
    )
    # ...and so does dropping the non-additive dimension.
    del _metric(changed, "QUALITY_ADJUSTED_ATP_KG")["non_additive_by"]
    assert (
        semantic.definition_hashes(changed)["QUALITY_ADJUSTED_ATP_KG"]
        != base["QUALITY_ADJUSTED_ATP_KG"]
    )


def test_comments_and_line_breaks_do_not_change_hashes():
    changed = copy.deepcopy(MODEL)
    m = _metric(changed, "TEMPERATURE_COMPLIANCE_PCT")
    m["comment"] = "reworded"
    m["expr"] = m["expr"].replace(" / ", "\n    /   ")  # runs of whitespace collapse to one space
    assert semantic.definition_hashes(changed) == semantic.definition_hashes(MODEL)


def test_a_stale_policy_hash_is_reported():
    policy = json.loads(semantic.POLICY.read_text(encoding="utf-8"))
    entry = next(e for e in policy["metric_registry"] if e["name"] == "DATA_AGE_MIN")
    entry["definition_hash"] = "0" * 64
    problems = semantic.policy_hash_problems(policy, MODEL)
    assert problems and problems[0].startswith("DATA_AGE_MIN: policy has 000")


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (
            lambda m: m["relationships"].append(
                {"name": "x", "from": "lots", "columns": ["a"], "to": "nope"}
            ),
            "unknown table",
        ),
        (
            lambda m: m["relationships"].append(
                {"name": "x", "from": "inventory", "columns": ["lot_id"], "to": "custody_exposure"}
            ),
            "whole key",
        ),
        (
            lambda m: m["metrics"].append({"name": "lots.bad", "expr": "SUM(lots.kg)"}),
            "aggregate facts only",
        ),
    ],
)
def test_structural_mistakes_are_caught(mutate, expected):
    changed = copy.deepcopy(MODEL)
    mutate(changed)
    assert any(expected in p for p in semantic.model_problems(changed))
