"""The evaluation engine: evidence pack + context -> scored options and the Decision Brief.

    evaluation = evaluate(pack, ctx, option_id_start=102)
    evaluation.options      # contract-valid option.json documents (default + fallback always there)
    evaluation.decision     # the rule decision, or None when the case escalates
    evaluation.brief        # brief.json when rule-decided; finalize_brief() adds an agent's choice

Every number comes from here: seeded (hash of case, option, pack revision, engine
version), versioned, and reproducible on replay. The LLM may choose among the
non-dominated options and explain - it never computes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from bbc_engine import __version__
from bbc_engine.constraints import eliminations, flags
from bbc_engine.context import EngineContext
from bbc_engine.generator import OptionSpec, expires_at, generate
from bbc_engine.montecarlo import seed_for
from bbc_engine.rank import (
    OBJECTIVE_VERSION,
    RULE_ID,
    Scored,
    margin,
    rank,
    recommendation_triggers,
    score_gap,
    understanding_triggers,
    why_codes,
)
from bbc_engine.simulate import Simulated, World, simulate

ENGINE_VERSION = __version__


def _canonical_hash(value: Any) -> str:
    # The ledger's canonical JSON (bbc_toolkit), inlined: the engine has no dependencies.
    import hashlib
    import json

    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


@dataclass
class Evaluation:
    options: list[dict[str, Any]]
    draft_brief: dict[str, Any]
    understanding_triggers: list[str]
    escalation_reasons: list[str]
    decision: dict[str, Any] | None
    brief: dict[str, Any] | None
    specs: dict[str, OptionSpec] = field(default_factory=dict)
    ids: dict[str, str] = field(default_factory=dict)  # option key -> option_id

    def option(self, key: str) -> dict[str, Any]:
        """The option generated for a key such as ``REROUTE:SITE-BAYLINE-SAC:PLAN``."""
        return next(o for o in self.options if o["option_id"] == self.ids[key])

    def key_of(self, option_id: str) -> str:
        return next(k for k, v in self.ids.items() if v == option_id)


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def evaluate(
    pack: dict[str, Any],
    ctx: EngineContext,
    *,
    option_id_start: int,
    finding: dict[str, Any] | None = None,
    samples: int | None = None,
    rec_id: str | None = None,
    generated_at: str | None = None,
) -> Evaluation:
    n = int(samples or ctx.p("montecarlo_samples"))
    world = World(pack, ctx, finding)
    specs = generate(pack, ctx)
    inputs_base = {
        "pack": pack["content_hash"],
        "policy": ctx.policy_version,
        "engine": ENGINE_VERSION,
    }

    sims: dict[str, Simulated] = {}
    for spec in specs:
        sims[spec.key] = simulate(
            spec, world, n, seed_for(pack["case_id"], spec.key, pack["revision"], ENGINE_VERSION)
        )
    default_key = next(s.key for s in specs if s.is_default)
    default_nrv = sims[default_key].nrv_mean

    ids = {spec.key: f"OPT-{option_id_start + i:08d}" for i, spec in enumerate(specs)}
    scored, options = [], []
    for spec in specs:
        sim = sims[spec.key]
        sim.outcome["financial"]["value_preserved_vs_default_usd"] = round(
            sim.nrv_mean - default_nrv, 2
        )
        elim = [
            {**e, "evidence_id": e["evidence_id"].format(option_id=ids[spec.key])}
            for e in eliminations(spec, sim, world, ctx)
        ]
        scored.append(Scored(spec.key, sim, feasible=not elim, is_default=spec.is_default))
        options.append(
            {
                "option_id": ids[spec.key],
                "case_id": pack["case_id"],
                "decision_point": pack["decision_point"],
                "option_set_rev": int(pack["revision"]),
                "origin": "GENERATOR",
                "parent_option_id": None,
                "label": spec.label,
                "is_default": spec.is_default,
                "is_fallback": spec.is_fallback,
                "bundle": {
                    "lots": [
                        {
                            "lot_id": lot["lot_id"],
                            "disposition": spec.disposition,
                            "destination_site_id": spec.route.site_id
                            if spec.disposition != "DISPOSE"
                            else None,
                            "kg": float(lot["kg"]),
                            "carrier_party_id": pack["shipment"]["carrier_party_id"]
                            if spec.disposition != "DISPOSE"
                            else None,
                        }
                        for lot in pack["lots"]
                    ],
                    "order_recovery": [p.as_bundle() for p in spec.plan.lines]
                    if not spec.keeps_lines
                    else [
                        {
                            "order_line_id": x["order_line_id"],
                            "action": "KEEP",
                            "replacement_lot_id": None,
                            "from_site_id": None,
                            "kg": float(x["kg"]),
                            "repromise_at": None,
                        }
                        for x in world.lines
                    ],
                    "financial": spec.financial
                    or [
                        {
                            "action": "NONE",
                            "counterparty_party_id": None,
                            "basis": None,
                            "amount_usd": None,
                            "variant": None,
                        }
                    ],
                },
                "feasible": not elim,
                "eliminations": elim,
                "flags": flags(spec, sim, world, ctx),
                "expires_at": _iso(expires_at(spec, pack)),
                "outcome": sim.outcome,
                "score": {
                    "risk_adjusted_usd": 0.0,
                    "rank": None,
                    "dominated_by": [],
                    "objective_version": OBJECTIVE_VERSION,
                },
                "provenance": {
                    "engine_version": ENGINE_VERSION,
                    "inputs_hash": _canonical_hash(
                        {**inputs_base, "option": spec.key, "samples": n}
                    ),
                    "seed": seed_for(pack["case_id"], spec.key, pack["revision"], ENGINE_VERSION),
                    "param_versions": {**pack["param_versions"], "engine": ENGINE_VERSION},
                    "pack_id": pack["pack_id"],
                },
                "evidence_id": f"EV:OPT:{ids[spec.key]}",
            }
        )

    ordered = rank(scored, ctx)
    by_key = {s.key: s for s in scored}
    for spec, option in zip(specs, options, strict=True):
        s = by_key[spec.key]
        option["score"].update(
            {
                "risk_adjusted_usd": round(s.score, 2),
                "rank": s.rank,
                "dominated_by": [ids[k] for k in s.dominated_by],
            }
        )

    value_at_risk = world.planned_value - default_nrv
    found = understanding_triggers(pack, ctx)
    reasons = recommendation_triggers(ordered, value_at_risk, pack, ctx)
    top = ordered[0] if ordered else None
    m = margin(ordered)
    gap = score_gap(ordered)
    draft = {
        "case_id": pack["case_id"],
        "decision_point": pack["decision_point"],
        "pack_id": pack["pack_id"],
        "generated_at": generated_at or pack["as_of"],
        "do_nothing": {"option_id": ids[default_key], "outcome": sims[default_key].outcome},
        "options": [
            {
                "option_id": o["option_id"],
                "label": o["label"],
                "outcome": o["outcome"],
                "flags": o["flags"],
                "expires_at": o["expires_at"],
            }
            for o in options
            if o["feasible"] and not o["is_default"]
        ],
        "value_table": [
            {
                "option_id": ids[s.key],
                "expected_nrv_usd": round(s.sim.nrv_mean, 2),
                "nrv_p10_usd": round(s.sim.nrv_p10, 2),
                "nrv_p90_usd": round(s.sim.nrv_p90, 2),
                "value_preserved_vs_default_usd": round(s.sim.nrv_mean - default_nrv, 2),
            }
            for s in ordered
        ],
        "eliminated": [
            {"option_id": o["option_id"], "label": o["label"], "reasons": o["eliminations"]}
            for o in options
            if not o["feasible"]
        ],
        "comparison": {
            "ranking": [ids[s.key] for s in ordered],
            "non_dominated": [ids[s.key] for s in ordered if not s.dominated_by],
            "margin_top2_usd": round(gap, 2) if gap is not None else None,
            "objective_version": OBJECTIVE_VERSION,
            "escalation_reasons": sorted(set(reasons)),
            "p_liab_attribution_only": round(world.p_liab_attribution, 4) if world.party else None,
            "p_liab_with_finding": round(world.p_liab, 4) if finding and world.party else None,
        },
        "precedents": [],
    }
    decision = None
    brief = None
    if top is not None and not reasons and not found:
        option = next(o for o in options if o["option_id"] == ids[top.key])
        decision = {
            "option_id": ids[top.key],
            **({"rec_id": rec_id} if rec_id else {}),
            "decided_by": "RULE",
            "decider_id": RULE_ID,
            "why_structured": why_codes(top, m, len(ordered), ctx),
            "narrative": narrative(
                option, sims[default_key], specs[[s.key for s in specs].index(top.key)]
            ),
        }
        brief = finalize_brief(draft, decision)
    return Evaluation(
        options, draft, found, sorted(set(reasons)), decision, brief, {s.key: s for s in specs}, ids
    )


def narrative(option: dict[str, Any], default: Simulated, spec: OptionSpec) -> str:
    """Template explanation for a rule decision - every number is the engine's."""
    f = option["outcome"]["financial"]
    op = option["outcome"]["operational"]
    text = (
        f"{option['label']}: highest risk-adjusted value "
        f"(${f['expected_nrv_usd']:,.0f} expected vs "
        f"${default.nrv_mean:,.0f} for doing nothing)"
    )
    if spec.route.min_sl_days and spec.disposition != "INSPECT":
        text += (
            f"; meets the {spec.route.min_sl_days:g}-day spec at {spec.route.site_id}"
            f" with P(accept) {op['p_accept']:.3f}"
        )
    lines = [] if spec.keeps_lines else spec.plan.lines
    fills = [p for p in lines if p.action == "FILL_FROM"]
    if fills:
        text += "; " + ", ".join(
            f"{p.order_line_id} is refilled in full from {p.replacement_lot_id}" for p in fills
        )
    return text + "."


def finalize_brief(draft: dict[str, Any], recommendation: dict[str, Any]) -> dict[str, Any]:
    """The sealed brief: the draft plus the recommendation, hashed (approvals cite the hash)."""
    body = {**draft, "recommendation": recommendation}
    return {**body, "brief_hash": _canonical_hash(body)}
