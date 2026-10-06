"""ACTION: the mutation gateway's pure logic (handlers in ``bbc_toolkit.gateway_procs``).

``DECISION.MUTATE`` is the only writer of DECISION.MUTATIONS. For each intent it runs the nine
steps of plan Phase 12 (validate, authorize, execute, before/after state, decision evidence,
actor chain, timestamps, metric snapshot, approvals) and records them in a contract-valid
mutation record (contracts/schemas/mutation_record.json).

* ``mutation_key`` - idempotency: hash(case, decision point, option, action, target, brief hash).
* ``authorization_hash`` - hash(intent, policy_eval_id, approval_ids). API.V_DISPATCHABLE
  recomputes it with LEDGER.CANONICAL_HASH, so a row edited outside the gateway never dispatches.
* ``expectations`` - the before-state the target must still be in, and the after-state the
  dispatcher must read back (ABORTED_PRECONDITION / FAILED otherwise).
* ``metric_drift`` - frozen decision values vs a live re-read of the canonical metrics; drift
  beyond tolerance requires re-authorization.
"""

from __future__ import annotations

from typing import Any

from bbc_toolkit import ledger

ENGINE_ROLE = "BBC_ENGINE"
EXTERNAL = {"SAP", "TMS", "CARRIER", "CUSTOMER_EDI", "EMAIL"}
IN_FLIGHT = ("PREPARED", "DISPATCHED", "ACKED")
DONE = ("VERIFIED", "SHADOW")
TERMINAL_BAD = ("ABORTED_PRECONDITION", "FAILED", "REJECTED", "EXPIRED", "CONFLICT")
# Actions whose dispatch adapters exist (blueberrychain.dispatch). Others are refused at
# validation, never half-executed.
DISPATCHABLE = {"REROUTE", "REPLACEMENT_ALLOCATION", "CLAIM_NOTICE", "STOCK_BLOCK", "SO_CHANGE"}
# A plan that changes both the physical route and the customer's supply is all-or-nothing:
# a re-route without its replacement (or vice versa) leaves the customer short.
COUPLED = {"REROUTE", "REPLACEMENT_ALLOCATION", "SO_CHANGE", "SO_CREATE"}
DRIFT_METRICS = ("REMAINING_SHELF_LIFE_DAYS",)


def mutation_key(case_id, decision_point, option_id, action_type, target_entity, brief_hash) -> str:
    return ledger.canonical_hash(
        {
            "case_id": case_id,
            "decision_point": decision_point,
            "option_id": option_id,
            "action_type": action_type,
            "target_entity": target_entity,
            "brief_hash": brief_hash,
        }
    )


def compensation_key(mutation_id: str) -> str:
    return ledger.canonical_hash({"compensation_of": mutation_id})


def authorization_hash(intent: dict[str, Any], eval_id: str, approval_ids: list[str]) -> str:
    return ledger.canonical_hash(
        {"intent": intent, "policy_eval_id": eval_id, "approval_ids": sorted(approval_ids)}
    )


def atomicity(actions: list[dict[str, Any]]) -> str:
    kinds = {a["action_type"] for a in actions}
    return "ALL_OR_NOTHING" if len(kinds & COUPLED) >= 2 else "BEST_EFFORT"


def expectations(action: dict[str, Any], live: dict[str, Any]) -> tuple[dict, dict, list[str]]:
    """(expected_before, expected_after, problems) for one action against the live OPS state
    (``live`` from gateway_procs.live_state). Problems refuse the mutation at validation."""
    p, kind = action["payload"], action["action_type"]
    problems: list[str] = []
    if kind == "REROUTE":
        ship = live.get("shipment") or {}
        if ship.get("status") != "IN_TRANSIT":
            problems.append(f"shipment {p['shipment_id']} is {ship.get('status')}, not IN_TRANSIT")
        return (
            {"destination_site_id": ship.get("destination_site_id"), "status": "IN_TRANSIT"},
            {"destination_site_id": p["new_destination_site_id"]},
            problems,
        )
    if kind == "REPLACEMENT_ALLOCATION":
        line = live.get("lines", {}).get(p["order_line_id"]) or {}
        atp = float(live.get("atp", {}).get((p["from_site_id"], p["replacement_lot_id"]), 0.0))
        if atp + 1e-6 < float(p["kg"]):
            problems.append(
                f"{p['replacement_lot_id']} has {atp:g} kg ATP at {p['from_site_id']}, "
                f"needs {float(p['kg']):g}"
            )
        return (
            {"assigned_lot_id": line.get("assigned_lot_id")},
            {"assigned_lot_id": p["replacement_lot_id"]},
            problems,
        )
    if kind == "SO_CHANGE":
        line = live.get("lines", {}).get(p["order_line_id"]) or {}
        return {"kg": line.get("kg")}, {"kg": p["kg"]}, problems
    if kind == "CLAIM_NOTICE":
        return {"notice_on_file": False}, {"notice_on_file": True}, problems
    if kind == "STOCK_BLOCK":
        return {"blocked": False}, {"blocked": True}, problems
    return {}, {}, [f"no dispatch adapter for {kind}"]


def metric_drift(
    frozen: list[dict[str, Any]], live: list[dict[str, Any]], tolerance_days: float
) -> tuple[list[dict[str, Any]], bool]:
    """Frozen (sealed pack) vs live (semantic view now) per metric; a shelf-life loss beyond
    tolerance needs re-authorization."""
    by_name = {(v["grain_key"], v["name"]): v for v in live}
    out, ok = [], True
    for v in frozen:
        cur = by_name.get((v["grain_key"], v["name"]))
        f = float(v["value"]) if v.get("value") is not None else None
        c = float(cur["value"]) if cur and cur.get("value") is not None else None
        delta = round(c - f, 6) if f is not None and c is not None else None
        within = delta is None or delta >= -tolerance_days
        ok &= within
        out.append(
            {
                "name": f"{v['name']}[{v['grain_key']}]",
                "frozen": f,
                "live": c,
                "delta": delta,
                "within_tolerance": within,
            }
        )
    return out, ok


def verify_after(expected: dict[str, Any], observed: dict[str, Any] | None) -> list[str]:
    if observed is None:
        return ["no observed after-state"]
    return [
        f"{k}: expected {v!r}, observed {observed.get(k)!r}"
        for k, v in expected.items()
        if observed.get(k) != v
    ]


def precondition_drift(expected: dict[str, Any], observed: dict[str, Any] | None) -> list[str]:
    if observed is None:
        return []
    return [
        f"{k}: expected {v!r}, observed {observed.get(k)!r}"
        for k, v in expected.items()
        if k in observed and observed.get(k) != v
    ]


def error(code: str, message: str, path: str | None = None) -> dict[str, Any]:
    out = {"code": code, "message": message[:1000]}
    if path:
        out["path"] = path
    return out
