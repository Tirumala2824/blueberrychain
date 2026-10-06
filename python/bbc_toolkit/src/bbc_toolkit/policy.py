"""Policy document checks: JSON Schema plus the semantic rules a schema cannot express.

``API.DRAFT_POLICY`` runs ``check_policy`` before writing a draft, so an
inconsistent policy can never be activated.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from bbc_toolkit import contracts

CANONICAL_METRICS = {
    "REMAINING_SHELF_LIFE_DAYS",
    "PREDICTED_SL_AT_ETA_DAYS",
    "SPEC_MARGIN_DAYS",
    "EXCESS_LIFE_SHARE",
    "PLANNED_VALUE_USD",
    "DEFAULT_COUNTERFACTUAL_USD",
    "VALUE_AT_RISK_USD",
    "PREDICTED_NRV_USD",
    "REALIZED_NRV_USD",
    "VALUE_PROTECTED_USD",
    "QUALITY_ADJUSTED_ATP_KG",
}
AUTHOR_AGENTS = {"EXCURSION_FORENSICS", "RECOVERY_STRATEGIST", "CLAIMS_RECOVERY"}


def _common_enum(name: str) -> list[str]:
    common = json.loads((contracts.contracts_dir() / "schemas" / "common.json").read_text("utf-8"))
    return common["$defs"][name]["enum"]


def check_policy(doc: dict[str, Any]) -> list[str]:
    """Return every problem with a policy document (empty list = activatable)."""
    problems = [f"schema {e.path}: {e.message}" for e in contracts.validate("policy.json", doc)]
    if problems:
        return problems  # semantic checks assume the shape is right

    rules = doc["decision_rights"]
    for kind, values in (
        ("rule_id", [r["rule_id"] for r in rules]),
        ("priority", [r["priority"] for r in rules]),
    ):
        for value, n in Counter(values).items():
            if n > 1:
                problems.append(f"decision_rights: duplicate {kind} {value}")
    for rule in rules:
        if rule["outcome"] == "APPROVE" and not rule["required_roles"]:
            problems.append(f"decision_rights {rule['rule_id']}: APPROVE needs at least one role")
        if rule["outcome"] != "APPROVE" and rule["required_roles"]:
            problems.append(f"decision_rights {rule['rule_id']}: only APPROVE rules name roles")
        lo, hi = rule["conditions"].get("min_value_usd"), rule["conditions"].get("max_value_usd")
        if lo is not None and hi is not None and lo > hi:
            problems.append(f"decision_rights {rule['rule_id']}: min_value_usd above max_value_usd")
    if not any(r["conditions"] == {} for r in rules):
        problems.append("decision_rights: needs a catch-all rule (empty conditions)")

    registered = {a["action_type"]: a for a in doc["action_types"]}
    for value, n in Counter(a["action_type"] for a in doc["action_types"]).items():
        if n > 1:
            problems.append(f"action_types: duplicate {value}")
    for missing in sorted(set(_common_enum("action_type")) - set(registered)):
        problems.append(f"action_types: {missing} is not registered")
    for action in doc["action_types"]:
        comp = action["compensation"]
        if comp is not None and comp not in registered:
            problems.append(
                f"action_types {action['action_type']}: compensation {comp} is not registered"
            )
        if action["reversibility"] == "IRREVERSIBLE" and action["max_level"] < 4:
            problems.append(
                f"action_types {action['action_type']}: "
                "irreversible actions cannot be capped below L4"
            )
        if action["reversibility"] == "IRREVERSIBLE" and comp is not None:
            problems.append(
                f"action_types {action['action_type']}: irreversible actions have no compensation"
            )

    triggers = [r["trigger"] for r in doc["router_rules"]]
    for value, n in Counter(triggers).items():
        if n > 1:
            problems.append(f"router_rules: duplicate trigger {value}")
    for missing in sorted(set(_common_enum("escalation_reason")) - set(triggers)):
        problems.append(f"router_rules: no rule for trigger {missing}")

    models = doc["model_registry"]
    author_models = {
        m["model"] for m in models if m["agent"] in AUTHOR_AGENTS and m["role"] == "PRIMARY"
    }
    for agent in AUTHOR_AGENTS | {"EVIDENCE_AUDITOR"}:
        if not any(m["agent"] == agent and m["role"] == "PRIMARY" for m in models):
            problems.append(f"model_registry: no PRIMARY model for {agent}")
    for m in models:
        if (
            m["agent"] == "EVIDENCE_AUDITOR"
            and m.get("must_differ_from_author")
            and m["model"] in author_models
        ):
            problems.append(f"model_registry: auditor model {m['model']} is also an author model")

    names = [m["name"] for m in doc["metric_registry"]]
    for value, n in Counter(names).items():
        if n > 1:
            problems.append(f"metric_registry: duplicate {value}")
    declared = {m["name"] for m in doc["metric_registry"] if m["canonical"]}
    for missing in sorted(CANONICAL_METRICS - declared):
        problems.append(f"metric_registry: canonical metric {missing} missing")
    for extra in sorted(declared - CANONICAL_METRICS):
        problems.append(f"metric_registry: {extra} is not a canonical metric (Phase 9)")

    p = doc["parameters"]
    if p["settlement_band_pct"]["min"] > p["settlement_band_pct"]["max"]:
        problems.append("parameters: settlement band min above max")
    for dimension, bands in doc["autonomy_thresholds"].items():
        for band in bands:
            lo, hi = band["l3_max"], band["l4_max"]
            if isinstance(lo, int | float) and isinstance(hi, int | float) and lo > hi:
                problems.append(
                    f"autonomy_thresholds {dimension}.{band['metric']}: l3_max above l4_max"
                )
    return problems
