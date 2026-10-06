"""Phase 12 - may this action run by itself, and if not, who must sign?

    level = min(global ceiling, action type's max level, decider cap, every dimension's cap)

Two policy tables decide (both versioned in GOV, read here from the policy document):

* Decision rights. Every rule whose conditions match applies: any DENY denies; the roles
  of every matching APPROVE rule are required. A matching AUTO rule *with conditions*
  marks a protective action (stock block, evidence request, claim notice) that skips the
  autonomy thresholds; the unconditional catch-all AUTO rule defers to them. A matching
  SHADOW rule records the action without dispatching it.
* Autonomy thresholds. Each metric is a "worse when larger" measure (booleans: True is
  worse). At or under ``l3_max`` the dimension allows automatic execution; at or under
  ``l4_max`` it requires its approver roles; beyond, ``beyond_l4`` applies: DUAL_APPROVAL
  (two approvers with different roles), L2 / L1 (cap the level), FALLBACK_ONLY (only the
  protective fallback may run).

The outcome per level: L4 executes after approval, L3 executes automatically inside every
L3 threshold, L2 recommends (a person initiates execution through the gateway), L1 / L0
execute nothing but the fallback. The protective fallback runs whenever ``fallback_enabled``,
even below L3. ``shadow_mode`` records everything and dispatches nothing;
``dispatch_enabled`` is the emergency stop.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

DIMENSIONS = ("financial", "customer", "inventory", "operational", "confidence", "data_quality")
REVERSIBILITY_RANK = {"REVERSIBLE": 0, "COMPENSATABLE": 1, "IRREVERSIBLE": 2}
CONFIDENCE_RANK = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}  # worse is larger, as the thresholds read
# What a food-safety-flagged lot may still undergo (GOV.HARD_LIMITS: INSPECT_HOLD_OR_DISPOSE_ONLY).
SAFE_ACTIONS = frozenset({"STOCK_BLOCK", "REQUEST_EVIDENCE", "CLAIM_NOTICE", "DISPOSE"})
DUAL_ROLES = ("BBC_FINANCE_MGR", "BBC_QUALITY_MGR")  # Finance + Ops when a dimension names one role


@dataclass(frozen=True)
class Action:
    action_type: str
    decision_point: str  # D1 | D2
    decider_kind: str  # RULE | AGENT | HUMAN | FALLBACK
    value_usd: float  # what the action commits (decision-rights value bands)
    metrics: dict[str, Any]  # every metric the thresholds name (see ``option_metrics``)
    customer_tiers: tuple[str, ...] = ()
    food_safety_flag: bool = False
    auditor_pass: bool | None = (
        None  # agent-written decisions: the Evidence Integrity Auditor's verdict
    )
    is_fallback: bool = False


@dataclass(frozen=True)
class Authorization:
    outcome: str  # AUTO | APPROVE | HUMAN_INITIATE | OBSERVE_ONLY | DENY
    level: int
    required_roles: tuple[str, ...] = ()
    dual_approval: bool = False
    shadow: bool = False
    dispatch: bool = True
    matched_rules: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()
    dimensions: tuple[dict[str, Any], ...] = field(default_factory=tuple)


def _within(value: Any, limit: Any) -> bool:
    if isinstance(limit, bool) or isinstance(value, bool):
        return bool(value) <= bool(limit)
    if isinstance(limit, str):
        return value == limit
    return float(value) <= float(limit)


def _matches(conditions: dict[str, Any], action: Action) -> bool:
    checks = {
        "action_types": lambda v: action.action_type in v,
        "decision_points": lambda v: action.decision_point in v,
        "decider_kinds": lambda v: action.decider_kind in v,
        "customer_tiers": lambda v: bool(set(v) & set(action.customer_tiers)),
        "food_safety_flag": lambda v: action.food_safety_flag == v,
        "min_value_usd": lambda v: action.value_usd >= float(v),
    }
    for key, wanted in conditions.items():
        if key not in checks:
            raise ValueError(f"unknown decision-rights condition {key!r}")
        if not checks[key](wanted):
            return False
    return True


def decision_rights(
    action: Action, policy: dict[str, Any]
) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
    """(DENY | APPROVE | PROTECTIVE | THRESHOLDS, required roles, matched rule ids)."""
    matched = [
        r
        for r in sorted(policy["decision_rights"], key=lambda r: r["priority"])
        if _matches(r.get("conditions") or {}, action)
    ]
    ids = tuple(r["rule_id"] for r in matched)
    if any(r["outcome"] == "DENY" for r in matched):
        return "DENY", (), ids
    roles = tuple(
        sorted({role for r in matched if r["outcome"] == "APPROVE" for role in r["required_roles"]})
    )
    if roles:
        return "APPROVE", roles, ids
    if any(r["outcome"] == "AUTO" and r.get("conditions") for r in matched):
        return "PROTECTIVE", (), ids
    return "THRESHOLDS", (), ids


def dimension_results(metrics: dict[str, Any], policy: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for dimension in DIMENSIONS:
        for rule in policy["autonomy_thresholds"][dimension]:
            if rule["metric"] not in metrics:
                raise ValueError(
                    f"autonomy metric {rule['metric']!r} ({dimension}) was not supplied"
                )
            value = metrics[rule["metric"]]
            if _within(value, rule["l3_max"]):
                band = "L3"
            elif rule.get("l4_max") is not None and _within(value, rule["l4_max"]):
                band = "L4"
            else:
                band = rule.get("beyond_l4", "L2")
            out.append(
                {
                    "dimension": dimension,
                    "metric": rule["metric"],
                    "value": value,
                    "band": band,
                    "approver_roles": list(rule.get("approver_roles") or []),
                }
            )
    return out


def authorize(action: Action, policy: dict[str, Any]) -> Authorization:
    params = policy["parameters"]
    flags = {"shadow": bool(params["shadow_mode"]), "dispatch": bool(params["dispatch_enabled"])}
    types = {t["action_type"]: t for t in policy["action_types"]}
    if action.action_type not in types:
        return Authorization(
            "DENY", 0, reasons=(f"unknown action type {action.action_type}",), **flags
        )
    kind = types[action.action_type]
    rights, rights_roles, rules = decision_rights(action, policy)
    shadow_rules = {r["rule_id"] for r in policy["decision_rights"] if r["outcome"] == "SHADOW"}
    if shadow_rules & set(rules):
        flags["shadow"] = True

    if action.is_fallback:
        if params["fallback_enabled"] and rights != "DENY":
            return Authorization(
                "AUTO",
                int(kind["max_level"]),
                matched_rules=rules,
                reasons=("protective fallback (fallback_enabled)",),
                **flags,
            )
        return Authorization(
            "DENY", 0, matched_rules=rules, reasons=("fallback disabled or denied",), **flags
        )
    if rights == "DENY":
        return Authorization(
            "DENY", 0, matched_rules=rules, reasons=("denied by decision rights",), **flags
        )

    decider_cap = 4
    reasons = []
    if action.decider_kind == "AGENT" and action.auditor_pass is not True:
        decider_cap = 2
        reasons.append("agent decision without an Auditor PASS: a person must initiate")
    caps = {
        "autonomy_ceiling": int(params["autonomy_ceiling"]),
        "action_max_level": int(kind["max_level"]),
        "decider": decider_cap,
    }
    roles = set(rights_roles)
    needs_approval = rights == "APPROVE"
    dual = False
    dims: list[dict[str, Any]] = []
    if rights != "PROTECTIVE":
        dims = dimension_results(action.metrics, policy)
        for d in dims:
            if d["band"] in ("L4", "DUAL_APPROVAL"):
                needs_approval = True
                roles.update(d["approver_roles"])
                dual |= d["band"] == "DUAL_APPROVAL"
            elif d["band"] in ("L2", "L1"):
                caps[f"{d['dimension']}:{d['metric']}"] = int(d["band"][1])
            elif d["band"] == "FALLBACK_ONLY" and action.action_type not in SAFE_ACTIONS:
                return Authorization(
                    "DENY",
                    0,
                    matched_rules=rules,
                    dimensions=tuple(dims),
                    reasons=(f"{d['metric']} allows only hold, inspect or dispose",),
                    **flags,
                )
    if kind["reversibility"] == "IRREVERSIBLE":
        needs_approval = True  # never L3
        reasons.append("irreversible: never automatic")
    if dual and len(roles) < 2:
        roles.update(DUAL_ROLES)
    level = min(caps.values())
    reasons += [f"{name} caps at L{cap}" for name, cap in caps.items() if cap == level and cap < 4]
    if level >= 4 and needs_approval:
        outcome = "APPROVE"
    elif level >= 3 and not needs_approval:
        outcome = "AUTO"
    elif level >= 2:
        outcome = "HUMAN_INITIATE"
        if needs_approval and level == 3:
            reasons.append("material action above the L3 thresholds at an L3 ceiling")
    else:
        outcome = "OBSERVE_ONLY"
    return Authorization(
        outcome,
        level,
        tuple(sorted(roles)) if outcome in ("APPROVE", "HUMAN_INITIATE") else (),
        dual if outcome == "APPROVE" else False,
        matched_rules=rules,
        reasons=tuple(reasons),
        dimensions=tuple(dims),
        **flags,
    )


def combine(results: Iterable[Authorization]) -> Authorization:
    """One decision bundle's authorization: the most restrictive of its actions."""
    order = {"DENY": 0, "OBSERVE_ONLY": 1, "HUMAN_INITIATE": 2, "APPROVE": 3, "AUTO": 4}
    items = list(results)
    worst = min(items, key=lambda a: (order[a.outcome], a.level))
    roles = (
        sorted({r for a in items for r in a.required_roles})
        if worst.outcome in ("APPROVE", "HUMAN_INITIATE")
        else []
    )
    return Authorization(
        worst.outcome,
        min(a.level for a in items),
        tuple(roles),
        any(a.dual_approval for a in items) and worst.outcome == "APPROVE",
        worst.shadow,
        worst.dispatch,
        tuple(dict.fromkeys(r for a in items for r in a.matched_rules)),
        tuple(dict.fromkeys(r for a in items for r in a.reasons)),
    )


def option_metrics(
    option: dict[str, Any],
    pack: dict[str, Any],
    action_type: str,
    policy: dict[str, Any],
    *,
    value_at_risk_usd: float,
    unresolved_conflicts: int | None = None,
) -> dict[str, Any]:
    """The threshold metrics for one action of a scored option, from the option and its pack."""
    outcome = option["outcome"]
    f = outcome["financial"]
    planned = sum(float(lot["planned_value_usd"]) for lot in pack["lots"])
    claims = sum(abs(float(a["amount_usd"] or 0)) for a in option["bundle"]["financial"])
    tiers = {x["order_line_id"]: x.get("customer_tier") for x in pack["affected_order_lines"]}
    changed = [r for r in option["bundle"]["order_recovery"] if r["action"] != "KEEP"]
    p_otif = [x["p_otif"] for x in outcome["customer"]["p_otif_by_line"]]
    shares = [a["share_of_site_atp"] for a in outcome["inventory"]["atp_consumed"]]
    snapshots = {i["lot_id"]: i["snapshot_at"] for i in pack["candidate_inventory"]}
    used = [
        snapshots[a["lot_id"]]
        for a in outcome["inventory"]["atp_consumed"]
        if a["lot_id"] in snapshots
    ]

    def hours_since(text: str) -> float:
        as_of = datetime.fromisoformat(pack["as_of"].replace("Z", "+00:00"))
        return (as_of - datetime.fromisoformat(text.replace("Z", "+00:00"))).total_seconds() / 3600

    coverage = min(
        (
            float(v["value"])
            for lot in pack["lots"]
            for v in lot["values"]
            if v["name"] == "MONITORING_COVERAGE_PCT"
        ),
        default=0.0,
    )
    ages = [
        float(v["data_age_min"])
        for lot in pack["lots"]
        for v in lot["values"]
        if v.get("data_age_min") is not None
    ]
    if unresolved_conflicts is None:
        unresolved_conflicts = sum(
            1
            for doc in pack["documents"]
            for c in doc["claims"]
            if (c.get("consistency") or {}).get("verdict") == "CONFLICT"
        )
    kinds = {t["action_type"]: t for t in policy["action_types"]}
    return {
        # the money the action moves against the plan: revenue change + costs + claimed amounts
        "action_value_usd": round(
            abs(planned - f["expected_revenue_usd"]) + outcome["recovery_cost_usd"] + claims, 2
        ),
        "value_at_risk_usd": round(value_at_risk_usd, 2),
        "tier_a_lines_affected": sum(1 for r in changed if tiers.get(r["order_line_id"]) == "A"),
        "p_otif_shortfall": round(1 - min(p_otif), 4) if p_otif else 0.0,
        "lines_affected": len(changed),
        "replacement_share_of_site_atp": max(shares, default=0.0),
        "stockout_risk_lines": sum(1 for s in shares if s >= 1.0),
        "p_reject": outcome["risk"]["p_reject"],
        "reversibility_rank": REVERSIBILITY_RANK[kinds[action_type]["reversibility"]],
        "food_safety_flag": outcome["risk"]["food_safety_flag"],
        "confidence_rank": CONFIDENCE_RANK[outcome["confidence"]["level"]],
        "data_age_min": max(ages, default=0.0),
        "coverage_shortfall_pct": round(max(100.0 - coverage, 0.0), 2),
        "unresolved_conflicts": unresolved_conflicts,
        "snapshot_age_h": round(max((hours_since(s) for s in used), default=0.0), 2),
    }
