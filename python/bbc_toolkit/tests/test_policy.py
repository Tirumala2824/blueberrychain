import copy
import json
from pathlib import Path

import pytest
from bbc_toolkit import contracts
from bbc_toolkit.policy import check_policy

SEED = contracts.contracts_dir().parent / "snowflake" / "seed" / "policy" / "v1.json"


@pytest.fixture(scope="module")
def policy():
    return json.loads(Path(SEED).read_text(encoding="utf-8"))


def test_seed_policy_is_activatable(policy):
    assert check_policy(policy) == []


def _rule(doc, rule_id):
    return next(r for r in doc["decision_rights"] if r["rule_id"] == rule_id)


def _action(doc, action_type):
    return next(a for a in doc["action_types"] if a["action_type"] == action_type)


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda d: d["action_types"].pop(), "is not registered"),
        (lambda d: _action(d, "STOCK_BLOCK").update(compensation="TELEPORT"), "schema"),
        (lambda d: _action(d, "SO_CREATE").update(compensation="WITHDRAW_CLAIM_X"), "schema"),
        (lambda d: _action(d, "DISPOSE").update(max_level=3), "cannot be capped below L4"),
        (
            lambda d: _action(d, "DISPOSE").update(compensation="STOCK_UNBLOCK"),
            "have no compensation",
        ),
        (lambda d: _rule(d, "DR-03").update(required_roles=[]), "APPROVE needs at least one role"),
        (
            lambda d: _rule(d, "DR-01").update(required_roles=["BBC_SALES_MGR"]),
            "only APPROVE rules name roles",
        ),
        (lambda d: _rule(d, "DR-04").update(priority=10), "duplicate priority 10"),
        (lambda d: d["decision_rights"].pop(), "catch-all rule"),
        (lambda d: d["router_rules"].pop(), "no rule for trigger NOVEL"),
        (
            lambda d: next(
                m for m in d["model_registry"] if m["agent"] == "EVIDENCE_AUDITOR"
            ).update(model="claude-sonnet-4-6"),
            "is also an author model",
        ),
        (
            lambda d: d["metric_registry"].pop(0),
            "canonical metric REMAINING_SHELF_LIFE_DAYS missing",
        ),
        (
            lambda d: d["parameters"]["settlement_band_pct"].update(min=90, max=50),
            "band min above max",
        ),
        (
            lambda d: d["autonomy_thresholds"]["financial"][0].update(l3_max=500000),
            "l3_max above l4_max",
        ),
    ],
)
def test_inconsistent_policies_are_rejected(policy, mutate, expected):
    broken = copy.deepcopy(policy)
    mutate(broken)
    problems = check_policy(broken)
    assert any(expected in p for p in problems), problems
