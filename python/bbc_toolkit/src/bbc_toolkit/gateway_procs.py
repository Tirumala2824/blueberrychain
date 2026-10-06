"""Mutation gateway and approval handlers (WP7a).

DECISION.MUTATE        - the only writer of DECISION.MUTATIONS (nine steps, gateway lock).
API.EXECUTE_PLAN       - an approved recommendation -> execution plan -> one MUTATE per step.
API.NEXT_ACTIONS       - the dispatcher leases the next AUTHORIZED steps from API.V_DISPATCHABLE.
API.ACK_MUTATION       - the dispatcher reports observed before / after states: VERIFIED,
                         ABORTED_PRECONDITION or FAILED (an ALL_OR_NOTHING plan compensates).
API.DECIDE_APPROVAL    - a persona approves / rejects; role checked from the caller's grants.
DECISION.ENFORCE_DEADLINES - the watchdog: expired approvals -> the protective fallback.
API.EMERGENCY_STOP     - stop all dispatch until the next policy activation.

Clocks: approval due times, option expiry and deadlines are event time (the pack's clock), so
they are compared with the world clock - the newest reading received (``WORLD_NOW_SQL``). In
a live deployment that is wall time within the ingest lag; in an accelerated simulation it is
the simulated present.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from bbc_toolkit import contracts, gateway, ledger, stages
from bbc_toolkit.snow import _as_obj, _current_user, _exec, _one, _sql, allocate_ids, ledger_append
from bbc_toolkit.stage_procs import (
    DEC,
    SV,
    _in,
    _objs,
    _transaction,
    _ts,
    active_policy,
    load_case,
    load_pack,
)

WORLD_NOW_SQL = f"SELECT {_ts('MAX(reading_ts)')} FROM BBC_OS.RAW.TELEMETRY"
LOCK_SQL = f"UPDATE {DEC}.GATEWAY_LOCK SET held_by = ?, held_at = CURRENT_TIMESTAMP() WHERE id = 1"
DRIFT_TOLERANCE_DAYS = (
    0.5  # plan Phase 12: shelf life lost since sealing that forces re-authorization
)
EXECUTABLE_STATES = ("APPROVED", "AUTO_APPROVED")


def _now() -> str:
    return stages.iso(datetime.now(UTC))


def world_now(session: Any) -> datetime:
    row = _one(session, WORLD_NOW_SQL)
    return stages.parse_ts(row[0]) if row and row[0] else datetime.now(UTC)


def user_roles(session: Any, user: str) -> set[str]:
    """Roles granted to a user. Inside an owner's-rights procedure CURRENT_ROLE() is the owner's,
    so the caller's roles are read from their grants (CURRENT_USER() is the caller: spike S9)."""
    rows = _sql(session, f'SHOW GRANTS TO USER "{user}"').collect()
    out = set()
    for r in rows:
        d = (
            r.as_dict()
            if hasattr(r, "as_dict")
            else dict(zip(["created_on", "role"], tuple(r), strict=False))
        )
        if str(d.get("granted_to", "USER")).upper() == "USER":
            out.add(str(d.get("role")).upper())
    return out


def dispatch_stopped(session: Any) -> bool:
    row = _one(
        session,
        "SELECT COUNT(*) FROM BBC_OS.GOV.EMERGENCY_STOPS s WHERE s.stopped_at > "
        "(SELECT MAX(activated_at) FROM BBC_OS.GOV.POLICY_VERSIONS WHERE activated_at IS NOT NULL)",
    )
    return bool(row and int(row[0]) > 0)


def live_state(session: Any, intent: dict[str, Any], lot_ids: list[str]) -> dict[str, Any]:
    """What the target looks like now, from OPS and the semantic view (expected before-state)."""
    p = intent["payload"]
    state: dict[str, Any] = {"lines": {}, "atp": {}}
    if intent["action_type"] == "REROUTE":
        rows = _objs(
            session,
            "SELECT OBJECT_CONSTRUCT_KEEP_NULL('status', status, 'destination_site_id', "
            "destination_site_id) FROM BBC_OS.OPS.SHIPMENTS WHERE shipment_id = ?",
            [p["shipment_id"]],
        )
        state["shipment"] = rows[0] if rows else None
    if intent["action_type"] in ("REPLACEMENT_ALLOCATION", "SO_CHANGE"):
        for r in _objs(
            session,
            "SELECT OBJECT_CONSTRUCT_KEEP_NULL('order_line_id', order_line_id, 'kg', kg, "
            "'assigned_lot_id', assigned_lot_id) FROM BBC_OS.OPS.ORDER_LINES WHERE order_line_id "
            "= ?",
            [p["order_line_id"]],
        ):
            state["lines"][r["order_line_id"]] = r
    if intent["action_type"] == "REPLACEMENT_ALLOCATION":
        for r in _objs(
            session,
            "SELECT OBJECT_CONSTRUCT_KEEP_NULL('site_id', site_id, 'lot_id', lot_id, 'atp', "
            f"quality_adjusted_atp_kg) FROM SEMANTIC_VIEW({SV} DIMENSIONS sites.site_id, "
            "lots.lot_id "
            "METRICS inventory.quality_adjusted_atp_kg) WHERE lot_id = ?",
            [p["replacement_lot_id"]],
        ):
            state["atp"][(r["site_id"], r["lot_id"])] = r["atp"]
    return state


def live_values(session: Any, lot_ids: list[str], as_of: str) -> list[dict[str, Any]]:
    """The canonical metrics re-read now, through the semantic view (metric snapshot: live)."""
    rows = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('lot_id', sv.lot_id, 'remaining_shelf_life_days', "
        f"sv.remaining_shelf_life_days, 'as_of', {_ts('lt.as_of')}) FROM SEMANTIC_VIEW({SV} "
        "DIMENSIONS lots.lot_id METRICS lot_thermal.remaining_shelf_life_days) sv "
        "JOIN BBC_OS.SEM.LOT_THERMAL lt ON lt.lot_id = sv.lot_id WHERE sv.lot_id IN "
        f"{_in(lot_ids)}",
        lot_ids,
    )
    return [
        {
            "name": "REMAINING_SHELF_LIFE_DAYS",
            "value": round(float(r["remaining_shelf_life_days"]), 4),
            "unit": "days",
            "grain": "lot",
            "as_of": r["as_of"],
            "data_age_min": None,
            "freshness": "OK",
            "metric_version": "1",
            "evidence_id": f"EV:MV:REMAINING_SHELF_LIFE_DAYS:{r['lot_id']}@{as_of}",
            "grain_key": r["lot_id"],
        }
        for r in rows
    ]


def _strip(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in x.items() if k != "grain_key"} for x in values]


# --------------------------------------------------------------------------------- MUTATE
def mutate(
    session: Any, intent: dict[str, Any], *, actor: str, kind: str = "ENGINE"
) -> dict[str, Any]:
    """The nine steps. Must run inside the caller's transaction (it takes the gateway lock)."""
    proposed_at = _now()
    errors = [
        gateway.error("SCHEMA", f"{e.path}: {e.message}")
        for e in contracts.validate("mutation_intent.json", intent)
    ]
    if errors:
        return {"status": "INVALID", "errors": errors}
    _exec(session, LOCK_SQL, [f"MUTATE {intent['idempotency_key'][:12]}"])
    # Idempotency: a duplicate returns the existing mutation, never re-executes.
    existing = _one(
        session,
        f"SELECT mutation_id, status FROM {DEC}.MUTATIONS WHERE idempotency_key = ?",
        [intent["idempotency_key"]],
    )
    if existing:
        return {
            "status": "DUPLICATE",
            "mutation_id": str(existing[0]),
            "mutation_status": str(existing[1]),
        }

    case = load_case(session, intent["case_id"])
    if case is None:
        return {"status": "INVALID", "errors": [gateway.error("UNKNOWN_CASE", intent["case_id"])]}
    _version, policy, _ = active_policy(session)
    rec = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('rec_id', rec_id, 'option_id', option_id, 'decided_by', "
        "decided_by, 'decider_id', decider_id, 'run_id', run_id, 'brief_hash', brief_hash, "
        "'status', "
        f"status, 'brief', brief) FROM {DEC}.RECOMMENDATIONS WHERE rec_id = ?",
        [intent["rec_id"]],
    )
    rec = rec[0] if rec else None
    option = _one(
        session,
        f"SELECT option, expires_at FROM {DEC}.OPTIONS WHERE option_id = ?",
        [intent["option_id"]],
    )
    pack = load_pack(session, intent["pack_id"])
    now_world = world_now(session)

    # 1. Validate
    v: list[dict[str, Any]] = []
    if rec is None or rec["status"] != "ACTIVE":
        v.append(gateway.error("NOT_ACTIVE", f"recommendation {intent['rec_id']} is not ACTIVE"))
    elif (
        rec["brief_hash"] != intent["brief_hash"]
        or case["current_brief_hash"] != intent["brief_hash"]
    ):
        v.append(gateway.error("BRIEF_CHANGED", "the brief hash is not the case's current brief"))
    elif (
        intent["compensation_of"] is None
        and _as_obj(rec["brief"])["recommendation"]["option_id"] != intent["option_id"]
    ):
        v.append(
            gateway.error("NOT_IN_BRIEF", "the option is not the sealed brief's recommendation")
        )
    if option is None:
        v.append(gateway.error("UNKNOWN_OPTION", intent["option_id"]))
    elif (
        intent["compensation_of"] is None
        and stages.parse_ts(_as_obj(option[0])["expires_at"]) <= now_world
    ):
        v.append(gateway.error("EXPIRED", f"option expired at {_as_obj(option[0])['expires_at']}"))
    if case["state"] not in (*EXECUTABLE_STATES, "EXECUTING", "EXECUTION_FAILED"):
        v.append(gateway.error("CASE_STATE", f"case is {case['state']}"))
    if intent["action_type"] not in gateway.DISPATCHABLE and intent["compensation_of"] is None:
        v.append(gateway.error("NO_ADAPTER", f"no dispatch adapter for {intent['action_type']}"))
    flagged = any(lot.get("food_safety_flag") for lot in pack["lots"])
    if flagged and intent["action_type"] in (
        "REROUTE",
        "SO_CREATE",
        "SO_CHANGE",
        "REPLACEMENT_ALLOCATION",
    ):
        v.append(
            gateway.error(
                "FOOD_SAFETY", "food-safety flagged product may only be held, inspected or disposed"
            )
        )
    lot_ids = [lot["lot_id"] for lot in pack["lots"]]
    in_flight = _one(
        session,
        f"SELECT mutation_id FROM {DEC}.MUTATIONS WHERE target_entity = ? AND status IN "
        f"{_in(list(gateway.IN_FLIGHT))} LIMIT 1",
        [json.dumps(intent["target_entity"], sort_keys=True), *gateway.IN_FLIGHT],
    )

    # 2. Authorize (policy evaluation of record, approvals, kill switches, executor principal)
    ev = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('eval_id', eval_id, 'outcome', outcome, "
        "'autonomy_level', "
        "autonomy_level, 'shadow', shadow, 'evaluation', evaluation, 'created_at', "
        f"{_ts('created_at')}) "
        f"FROM {DEC}.POLICY_EVALUATIONS WHERE rec_id = ? ORDER BY created_at DESC LIMIT 1",
        [intent["rec_id"]],
    )
    ev = ev[0] if ev else None
    approvals = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('approval_id', approval_id, 'status', status, 'role', "
        "required_role, 'user', decided_by, 'proposer', proposer, 'brief_hash', "
        "brief_hash_at_request, "
        f"'decided_at', {_ts('decided_at')}) FROM {DEC}.APPROVALS WHERE eval_id = ? ORDER BY "
        "approval_id",
        [ev["eval_id"] if ev else ""],
    )
    a: list[dict[str, Any]] = []
    if ev is None:
        a.append(gateway.error("NO_EVALUATION", "no policy evaluation for the recommendation"))
    else:
        if ev["outcome"] in ("DENY", "OBSERVE_ONLY"):
            a.append(gateway.error("DENIED", f"policy outcome {ev['outcome']}"))
        if ev["outcome"] in ("APPROVE", "HUMAN_INITIATE"):
            if not approvals or any(x["status"] != "APPROVED" for x in approvals):
                a.append(
                    gateway.error("APPROVAL_MISSING", "every required approval must be APPROVED")
                )
            if any(x["user"] == x["proposer"] for x in approvals):
                a.append(gateway.error("SELF_APPROVAL", "an approver proposed this decision"))
            if len({x["user"] for x in approvals}) != len(approvals):
                a.append(gateway.error("SAME_APPROVER", "one user approved more than one role"))
            if any(x["brief_hash"] != intent["brief_hash"] for x in approvals):
                a.append(gateway.error("STALE_APPROVAL", "an approval was given on another brief"))
    params = policy["parameters"]
    if int(params["autonomy_ceiling"]) < 3 and ev and ev["outcome"] == "AUTO":
        a.append(gateway.error("CEILING", f"autonomy ceiling is L{params['autonomy_ceiling']}"))
    roles = user_roles(session, actor)
    if gateway.ENGINE_ROLE not in roles and "BBC_OWNER" not in roles:
        a.append(gateway.error("EXECUTOR", f"{actor} is not the engine principal"))
    if "BBC_AGENT_RUNTIME" in roles:
        a.append(gateway.error("EXECUTOR", "an agent principal may never execute"))

    # 4. Expected before / after, against the latest OPS data
    expected_before, expected_after, problems = gateway.expectations(
        {"action_type": intent["action_type"], "payload": intent["payload"]},
        live_state(session, intent, lot_ids),
    )
    if intent["compensation_of"] is None:
        v += [gateway.error("PRECONDITION", p) for p in problems]
    if in_flight:
        v.append(gateway.error("CONFLICT", f"{in_flight[0]} is in flight on the same target"))
    intent = {
        **intent,
        "expected_before": expected_before or intent["expected_before"],
        "expected_after": expected_after or intent["expected_after"],
    }

    # 8. Metric snapshot: frozen (sealed pack) vs live (semantic view now)
    frozen = [
        {**val, "grain_key": lot["lot_id"]}
        for lot in pack["lots"]
        for val in lot["values"]
        if val["name"] in gateway.DRIFT_METRICS
    ]
    live = live_values(session, lot_ids, stages.iso(now_world))
    drift, drift_ok = gateway.metric_drift(frozen, live, DRIFT_TOLERANCE_DAYS)
    if not drift_ok and intent["compensation_of"] is None:
        a.append(
            gateway.error(
                "DRIFT", f"shelf life fell more than {DRIFT_TOLERANCE_DAYS} days since sealing"
            )
        )

    approval_ids = [x["approval_id"] for x in approvals if x["status"] == "APPROVED"]
    shadow = bool(params["shadow_mode"]) or bool(ev and ev["shadow"])
    external = intent["target_system"] in gateway.EXTERNAL
    if v:
        status = "CONFLICT" if any(e["code"] == "CONFLICT" for e in v) else "ABORTED_PRECONDITION"
    elif a:
        status = "REJECTED"
    elif shadow:
        status = "SHADOW"
    else:
        status = "AUTHORIZED" if external else "VERIFIED"
    auth_hash = (
        gateway.authorization_hash(intent, ev["eval_id"], approval_ids)
        if ev and not v and not a
        else None
    )
    mutation_id = allocate_ids(session, "MUTATION", 1)[0]
    errs = v + a
    record = {
        "mutation_id": mutation_id,
        "intent": intent,
        "status": status,
        "validation": {"passed": not v, "errors": errs},
        "autonomy_level": int(ev["autonomy_level"]) if ev else 0,
        "policy_eval_id": ev["eval_id"] if ev else "EVAL-00000000",
        "approval_ids": approval_ids,
        "authorization_hash": auth_hash,
        "observed_before": None,
        "observed_after": None,
        "metric_snapshot": {"frozen": _strip(frozen), "live": _strip(live), "drift": drift},
        "actor_chain": {
            "decider_kind": rec["decided_by"] if rec else "RULE",
            "decider_id": rec["decider_id"] if rec else "UNKNOWN",
            "agent_run_id": rec["run_id"] if rec else None,
            "model": None,
            "spec_version": None,
            "executor_user": actor,
            "executor_role": gateway.ENGINE_ROLE if gateway.ENGINE_ROLE in roles else "BBC_OWNER",
            "approvers": [
                {"user": x["user"], "role": x["role"], "approval_id": x["approval_id"]}
                for x in approvals
                if x["status"] == "APPROVED"
            ],
        },
        "timestamps": {
            "proposed_at": proposed_at,
            "evaluated_at": stages.iso(ev["created_at"]) if ev else None,
            "approved_at": max(
                (stages.iso(x["decided_at"]) for x in approvals if x["decided_at"]), default=None
            ),
            "authorized_at": _now() if status in ("AUTHORIZED", "VERIFIED", "SHADOW") else None,
            "dispatched_at": None,
            "acked_at": None,
            "verified_at": _now() if status == "VERIFIED" else None,
            "target_reported_at": None,
        },
        "external_ref": None,
        "attempts": 0,
        "last_error": errs[0] if errs else None,
        "compensated_by": None,
    }
    record_errors = contracts.validate("mutation_record.json", record)
    if record_errors:
        raise RuntimeError(f"mutation record invalid: {[e.message for e in record_errors[:3]]}")
    entry = ledger_append(
        session,
        entry_type="MUTATION",
        case_id=intent["case_id"],
        actor=actor,
        record_ref=f"{DEC}.MUTATIONS#{mutation_id}",
        payload={
            "mutation_id": mutation_id,
            "status": status,
            "action_type": intent["action_type"],
            "target_entity": intent["target_entity"],
            "idempotency_key": intent["idempotency_key"],
            "authorization_hash": auth_hash,
            "policy_eval_id": record["policy_eval_id"],
            "approval_ids": approval_ids,
            "requested_by": kind,
            "errors": errs,
            "record_hash": ledger.canonical_hash(record),
        },
    )
    _exec(
        session,
        f"INSERT INTO {DEC}.MUTATIONS (mutation_id, case_id, decision_point, rec_id, plan_id, "
        "step_seq, "
        "action_type, target_system, target_entity, idempotency_key, status, autonomy_level, "
        "policy_eval_id, approval_ids, authorization_hash, intent, record, attempts, "
        "compensation_of, "
        "created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
        "PARSE_JSON(?)::ARRAY, ?, "
        "PARSE_JSON(?), PARSE_JSON(?), 0, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()",
        [
            mutation_id,
            intent["case_id"],
            intent["decision_point"],
            intent["rec_id"],
            intent["plan_id"],
            intent["step_seq"],
            intent["action_type"],
            intent["target_system"],
            json.dumps(intent["target_entity"], sort_keys=True),
            intent["idempotency_key"],
            status,
            record["autonomy_level"],
            record["policy_eval_id"],
            json.dumps(approval_ids),
            auth_hash,
            json.dumps(intent),
            json.dumps(record),
            intent["compensation_of"],
        ],
    )
    return {
        "status": "OK",
        "mutation_id": mutation_id,
        "mutation_status": status,
        "errors": errs,
        "ledger_seq": entry.seq,
    }


# ----------------------------------------------------------------------------- EXECUTE_PLAN
def _set_case(session, case_id, from_states, to_state, actor, payload):
    rows = _sql(
        session,
        f"UPDATE {DEC}.CASES SET state = ?, state_version = state_version + 1, updated_at = "
        "CURRENT_TIMESTAMP() "
        f"WHERE case_id = ? AND state IN {_in(list(from_states))}",
        [to_state, case_id, *from_states],
    ).collect()
    if not rows or int(next(iter(rows[0]))) != 1:
        raise RuntimeError(f"{case_id} is not in {list(from_states)}")
    ledger_append(
        session,
        entry_type="TRANSITION",
        case_id=case_id,
        actor=actor,
        record_ref=f"{DEC}.CASES#{case_id}",
        payload={"case_id": case_id, "from": list(from_states), "to": to_state, **payload},
    )


def execute_plan(
    session: Any, case_id: str, rec_id: str, *, kind: str = "ENGINE"
) -> dict[str, Any]:
    case = load_case(session, case_id)
    if case is None or case["state"] not in EXECUTABLE_STATES or case["current_rec_id"] != rec_id:
        return {"status": "INVALID", "errors": [f"{case_id} is not approved for {rec_id}"]}
    pack = load_pack(session, case["current_pack_id"])
    rec = _one(
        session,
        f"SELECT option_id, brief_hash FROM {DEC}.RECOMMENDATIONS WHERE rec_id = ?",
        [rec_id],
    )
    option = _as_obj(
        _one(session, f"SELECT option FROM {DEC}.OPTIONS WHERE option_id = ?", [rec[0]])[0]
    )
    evaluation = _as_obj(
        _one(
            session,
            f"SELECT evaluation FROM {DEC}.POLICY_EVALUATIONS WHERE rec_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            [rec_id],
        )[0]
    )
    actions = stages.bundle_actions(option, pack)
    authorized = [
        (x["action_type"], json.dumps(x["target_entity"], sort_keys=True))
        for x in evaluation["actions"]
    ]
    if [
        (x["action_type"], json.dumps(x["target_entity"], sort_keys=True)) for x in actions
    ] != authorized:
        return {
            "status": "INVALID",
            "errors": ["the plan's actions differ from the ones policy evaluated"],
        }
    actor = _current_user(session)

    def work():
        plan_id = allocate_ids(session, "PLAN", 1)[0]
        steps = [
            {
                "step_seq": x["step_seq"],
                "action_type": x["action_type"],
                "target_system": x["target_system"],
                "target_entity": x["target_entity"],
            }
            for x in actions
        ]
        mode = gateway.atomicity(actions)
        _exec(
            session,
            f"INSERT INTO {DEC}.EXECUTION_PLANS (plan_id, case_id, rec_id, atomicity, status, "
            "steps, "
            "created_at, updated_at) SELECT ?, ?, ?, ?, 'EXECUTING', PARSE_JSON(?), "
            "CURRENT_TIMESTAMP(), "
            "CURRENT_TIMESTAMP()",
            [plan_id, case_id, rec_id, mode, json.dumps(steps)],
        )
        results = []
        for x in actions:
            intent = {
                "case_id": case_id,
                "decision_point": case["decision_point"],
                "rec_id": rec_id,
                "option_id": rec[0],
                "plan_id": plan_id,
                "step_seq": x["step_seq"],
                "action_type": x["action_type"],
                "target_system": x["target_system"],
                "target_entity": x["target_entity"],
                "payload": x["payload"],
                "idempotency_key": gateway.mutation_key(
                    case_id,
                    case["decision_point"],
                    rec[0],
                    x["action_type"],
                    x["target_entity"],
                    rec[1],
                ),
                "brief_hash": rec[1],
                "pack_id": pack["pack_id"],
                "expected_before": {},
                "expected_after": {},
                "compensation_of": None,
                "requested_by": {"kind": kind, "principal": actor},
            }
            results.append(
                {
                    "step_seq": x["step_seq"],
                    "action_type": x["action_type"],
                    **mutate(session, intent, actor=actor, kind=kind),
                }
            )
        bad = [
            r
            for r in results
            if r.get("mutation_status") in gateway.TERMINAL_BAD or r["status"] != "OK"
        ]
        _set_case(
            session,
            case_id,
            EXECUTABLE_STATES,
            "EXECUTION_FAILED" if bad else "EXECUTING",
            actor,
            {
                "plan_id": plan_id,
                "atomicity": mode,
                "mutations": [r.get("mutation_id") for r in results],
            },
        )
        if bad:
            _exec(
                session,
                f"UPDATE {DEC}.EXECUTION_PLANS SET status = 'FAILED', updated_at = "
                "CURRENT_TIMESTAMP() "
                "WHERE plan_id = ?",
                [plan_id],
            )
        return {"plan_id": plan_id, "atomicity": mode, "steps": results}

    return {"status": "OK", **_transaction(session, work)}


# ------------------------------------------------------------------------ dispatch + ACK
def next_actions(session: Any, dispatcher_id: str, limit: int, lease_s: int) -> dict[str, Any]:
    """The next dispatchable step of each executing plan (earlier steps must be VERIFIED)."""
    actor = _current_user(session)

    def work():
        rows = _objs(
            session,
            "SELECT OBJECT_CONSTRUCT_KEEP_NULL('mutation_id', d.mutation_id, 'intent', d.intent, "
            "'attempts', d.attempts) FROM BBC_OS.API.V_DISPATCHABLE d "
            "WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.MUTATIONS e WHERE e.plan_id = "
            "d.plan_id "
            "AND e.step_seq < d.step_seq AND e.compensation_of IS NULL AND e.status NOT IN "
            "('VERIFIED', 'SHADOW')) "
            "AND (d.lease_until IS NULL OR d.lease_until < CURRENT_TIMESTAMP()) "
            "ORDER BY d.created_at, d.step_seq LIMIT ?",
            [int(limit)],
        )
        leased = []
        for r in rows:
            n = int(r["attempts"] or 0) + 1
            _exec(
                session,
                f"UPDATE {DEC}.MUTATIONS SET status = 'PREPARED', lease_owner = ?, attempts = ?, "
                "lease_until = DATEADD('second', ?, CURRENT_TIMESTAMP()), updated_at = "
                "CURRENT_TIMESTAMP() "
                "WHERE mutation_id = ? AND status = 'AUTHORIZED'",
                [dispatcher_id, n, int(lease_s), r["mutation_id"]],
            )
            intent = _as_obj(r["intent"])
            ledger_append(
                session,
                entry_type="MUTATION",
                case_id=intent["case_id"],
                actor=actor,
                record_ref=f"{DEC}.MUTATIONS#{r['mutation_id']}",
                payload={
                    "mutation_id": r["mutation_id"],
                    "status": "PREPARED",
                    "attempt": n,
                    "dispatcher": dispatcher_id,
                },
            )
            leased.append({"mutation_id": r["mutation_id"], "attempt": n, "intent": intent})
        return leased

    return {"status": "OK", "actions": _transaction(session, work)}


def ack_mutation(
    session: Any, mutation_id: str, attempt: int, ack: dict[str, Any]
) -> dict[str, Any]:
    row = _one(
        session,
        f"SELECT status, record, attempts, plan_id, case_id FROM {DEC}.MUTATIONS WHERE "
        "mutation_id = ?",
        [mutation_id],
    )
    if row is None:
        return {"status": "INVALID", "errors": [f"unknown mutation {mutation_id}"]}
    status, record, attempts, plan_id, case_id = (
        str(row[0]),
        _as_obj(row[1]),
        int(row[2]),
        row[3],
        str(row[4]),
    )
    if status in gateway.DONE or status in gateway.TERMINAL_BAD:
        return {
            "status": "OK",
            "mutation_id": mutation_id,
            "mutation_status": status,
            "replayed": True,
        }
    if status != "PREPARED" or int(attempt) != attempts:
        return {"status": "INVALID", "errors": [f"{mutation_id} is {status} (attempt {attempts})"]}
    intent = record["intent"]
    drift = gateway.precondition_drift(intent["expected_before"], ack.get("observed_before"))
    after = gateway.verify_after(intent["expected_after"], ack.get("observed_after"))
    if ack.get("error"):
        new = (
            "ABORTED_PRECONDITION"
            if ack["error"].get("code") in ("PRECONDITION", "412", "409")
            else "FAILED"
        )
    elif drift:
        new = "ABORTED_PRECONDITION"
    elif after:
        new = "FAILED"
    else:
        new = "VERIFIED"
    errs = [gateway.error("PRECONDITION", d) for d in drift] + [
        gateway.error("VERIFY", d) for d in after
    ]
    if ack.get("error"):
        target = ack["error"]
        errs.insert(
            0, gateway.error("TARGET", f"{target.get('code', '')}: {target.get('message', '')}")
        )
    now = _now()
    record.update(
        status=new,
        observed_before=ack.get("observed_before"),
        observed_after=ack.get("observed_after"),
        external_ref=ack.get("external_ref"),
        attempts=attempts,
        last_error=errs[0] if errs else None,
    )
    record["timestamps"].update(
        dispatched_at=ack.get("dispatched_at") or now,
        acked_at=now,
        verified_at=now if new == "VERIFIED" else None,
        target_reported_at=ack.get("target_reported_at"),
    )
    actor = _current_user(session)

    def work():
        _exec(
            session,
            f"UPDATE {DEC}.MUTATIONS SET status = ?, record = PARSE_JSON(?), external_ref = ?, "
            "lease_owner = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP() "
            "WHERE mutation_id = ? AND status = 'PREPARED'",
            [new, json.dumps(record), ack.get("external_ref"), mutation_id],
        )
        entry = ledger_append(
            session,
            entry_type="MUTATION",
            case_id=case_id,
            actor=actor,
            record_ref=f"{DEC}.MUTATIONS#{mutation_id}",
            payload={
                "mutation_id": mutation_id,
                "status": new,
                "attempt": attempts,
                "observed_before": ack.get("observed_before"),
                "observed_after": ack.get("observed_after"),
                "external_ref": ack.get("external_ref"),
                "errors": errs,
                "record_hash": ledger.canonical_hash(record),
            },
        )
        outcome = _plan_progress(session, plan_id, case_id, actor) if plan_id else None
        return {"ledger_seq": entry.seq, "plan": outcome}

    return {
        "status": "OK",
        "mutation_id": mutation_id,
        "mutation_status": new,
        "errors": errs,
        **_transaction(session, work),
    }


def _plan_progress(session, plan_id, case_id, actor) -> str:
    rows = _sql(
        session,
        f"SELECT status, compensation_of IS NOT NULL FROM {DEC}.MUTATIONS WHERE plan_id = ?",
        [plan_id],
    ).collect()
    steps = [(str(next(iter(r))), bool(tuple(r)[1])) for r in rows if not bool(tuple(r)[1])]
    if steps and all(s in gateway.DONE for s, _ in steps):
        _exec(
            session,
            f"UPDATE {DEC}.EXECUTION_PLANS SET status = 'DONE', updated_at = CURRENT_TIMESTAMP() "
            "WHERE plan_id = ?",
            [plan_id],
        )
        by = _one(
            session,
            f"SELECT r.decided_by FROM {DEC}.EXECUTION_PLANS p JOIN {DEC}.RECOMMENDATIONS r "
            "ON r.rec_id = p.rec_id WHERE p.plan_id = ?",
            [plan_id],
        )
        executed = "FALLBACK_EXECUTED" if by and str(by[0]) == "FALLBACK" else "EXECUTED"
        _set_case(session, case_id, ("EXECUTING",), executed, actor, {"plan_id": plan_id})
        _set_case(session, case_id, (executed,), "AWAITING_OUTCOME", actor, {"plan_id": plan_id})
        return "DONE"
    if any(s in gateway.TERMINAL_BAD for s, _ in steps):
        mode = str(
            _one(
                session, f"SELECT atomicity FROM {DEC}.EXECUTION_PLANS WHERE plan_id = ?", [plan_id]
            )[0]
        )
        if mode == "ALL_OR_NOTHING":
            _compensate(session, plan_id, case_id, actor)
            _exec(
                session,
                f"UPDATE {DEC}.EXECUTION_PLANS SET status = 'COMPENSATING', "
                "updated_at = CURRENT_TIMESTAMP() WHERE plan_id = ?",
                [plan_id],
            )
            _set_case(
                session,
                case_id,
                ("EXECUTING",),
                "EXECUTION_FAILED",
                actor,
                {"plan_id": plan_id, "compensating": True},
            )
            return "COMPENSATING"
        _exec(
            session,
            f"UPDATE {DEC}.EXECUTION_PLANS SET status = 'PARTIAL', updated_at = "
            "CURRENT_TIMESTAMP() "
            "WHERE plan_id = ?",
            [plan_id],
        )
        return "PARTIAL"
    return "EXECUTING"


COMPENSATIONS = {
    "REROUTE": "REROUTE_BACK",
    "REPLACEMENT_ALLOCATION": "DEALLOCATE",
    "CLAIM_NOTICE": "WITHDRAW_NOTICE",
    "STOCK_BLOCK": "STOCK_UNBLOCK",
    "SO_CHANGE": "SO_REVERT",
}


def _compensate(session, plan_id, case_id, actor):
    """ALL_OR_NOTHING: undo the VERIFIED steps in reverse order, through MUTATE."""
    done = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('mutation_id', mutation_id, 'record', record) FROM "
        f"{DEC}.MUTATIONS WHERE plan_id = ? AND status = 'VERIFIED' AND compensation_of IS NULL "
        "ORDER BY step_seq DESC",
        [plan_id],
    )
    for d in done:
        original = _as_obj(d["record"])["intent"]
        action = COMPENSATIONS.get(original["action_type"])
        if action is None:
            continue
        intent = {
            **original,
            "action_type": action,
            "payload": {**original["payload"], "restore": original["expected_before"]},
            "idempotency_key": gateway.compensation_key(d["mutation_id"]),
            "expected_before": original["expected_after"],
            "expected_after": original["expected_before"],
            "compensation_of": d["mutation_id"],
            "requested_by": {"kind": "ENGINE", "principal": actor},
        }
        result = mutate(session, intent, actor=actor)
        if result.get("mutation_id"):
            _exec(
                session,
                f"UPDATE {DEC}.MUTATIONS SET compensated_by = ? WHERE mutation_id = ?",
                [result["mutation_id"], d["mutation_id"]],
            )


# ------------------------------------------------------------------------------ approvals
def decide_approval(
    session: Any, approval_id: str, verdict: str, chosen_option_id: str | None, reason: str
) -> dict[str, Any]:
    verdict = (verdict or "").upper()
    if verdict not in ("APPROVE", "REJECT", "ALTERNATIVE"):
        return {"status": "INVALID", "errors": ["VERDICT must be APPROVE, REJECT or ALTERNATIVE"]}
    if not reason or not reason.strip():
        return {"status": "INVALID", "errors": ["REASON is required"]}
    rows = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('approval_id', approval_id, 'case_id', case_id, "
        "'eval_id', "
        "eval_id, 'rec_id', rec_id, 'role', required_role, 'status', status, 'proposer', proposer, "
        "'brief_hash', brief_hash_at_request, 'pack_hash', pack_hash_at_request, 'due_at', "
        f"{_ts('due_at')}) "
        f"FROM {DEC}.APPROVALS WHERE approval_id = ?",
        [approval_id],
    )
    if not rows:
        return {"status": "INVALID", "errors": [f"unknown approval {approval_id}"]}
    ap = rows[0]
    user = _current_user(session)
    roles = user_roles(session, user)
    case = load_case(session, ap["case_id"])
    pack_hash = _one(
        session,
        "SELECT content_hash FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS WHERE pack_id = ?",
        [case["current_pack_id"]],
    )
    now_world = world_now(session)
    freshness = {
        "brief_hash_at_request": ap["brief_hash"],
        "brief_hash_now": case["current_brief_hash"],
        "pack_hash_at_request": ap["pack_hash"],
        "pack_hash_now": pack_hash[0] if pack_hash else None,
        "due_at": ap["due_at"],
        "world_now": stages.iso(now_world),
    }
    denied = []
    if ap["role"].upper() not in roles:
        denied.append(f"{user} does not hold {ap['role']}")
    if user == ap["proposer"]:
        denied.append("the proposer cannot approve")
    others = _sql(
        session,
        f"SELECT approval_id FROM {DEC}.APPROVALS WHERE eval_id = ? AND decided_by = ? "
        "AND approval_id <> ?",
        [ap["eval_id"], user, approval_id],
    ).collect()
    if others:
        denied.append(f"{user} already decided another role of this evaluation")
    if denied:
        return {"status": "DENIED", "errors": denied}
    if ap["status"] != "REQUESTED":
        return {
            "status": "OK",
            "approval_id": approval_id,
            "approval_status": ap["status"],
            "replayed": True,
        }
    stale = (
        freshness["brief_hash_now"] != ap["brief_hash"]
        or freshness["pack_hash_now"] != ap["pack_hash"]
        or case["state"] != "PENDING_APPROVAL"
    )
    expired = stages.parse_ts(ap["due_at"]) <= now_world
    new = (
        "STALE"
        if stale
        else "EXPIRED"
        if expired
        else {"APPROVE": "APPROVED", "REJECT": "REJECTED", "ALTERNATIVE": "ALTERNATIVE_CHOSEN"}[
            verdict
        ]
    )

    def work():
        _exec(
            session,
            f"UPDATE {DEC}.APPROVALS SET status = ?, decided_by = ?, decided_role = ?, decided_at "
            "= "
            "CURRENT_TIMESTAMP(), chosen_option_id = ?, reason = ?, freshness = PARSE_JSON(?) "
            "WHERE approval_id = ? AND status = 'REQUESTED'",
            [
                new,
                user,
                ap["role"],
                chosen_option_id if new == "ALTERNATIVE_CHOSEN" else None,
                reason,
                json.dumps(freshness),
                approval_id,
            ],
        )
        entry = ledger_append(
            session,
            entry_type="APPROVAL",
            case_id=ap["case_id"],
            actor=user,
            record_ref=f"{DEC}.APPROVALS#{approval_id}",
            payload={
                "approval_id": approval_id,
                "eval_id": ap["eval_id"],
                "rec_id": ap["rec_id"],
                "role": ap["role"],
                "status": new,
                "reason": reason,
                "chosen_option_id": chosen_option_id,
                "freshness": freshness,
            },
        )
        _exec(
            session,
            f"UPDATE {DEC}.APPROVALS SET ledger_seq = ? WHERE approval_id = ?",
            [entry.seq, approval_id],
        )
        statuses = [
            str(next(iter(r)))
            for r in _sql(
                session, f"SELECT status FROM {DEC}.APPROVALS WHERE eval_id = ?", [ap["eval_id"]]
            ).collect()
        ]
        state = case["state"]
        if new == "APPROVED" and all(s == "APPROVED" for s in statuses):
            _set_case(
                session,
                ap["case_id"],
                ("PENDING_APPROVAL",),
                "APPROVED",
                user,
                {"eval_id": ap["eval_id"]},
            )
            state = "APPROVED"
        elif new in ("REJECTED", "ALTERNATIVE_CHOSEN"):
            _set_case(
                session,
                ap["case_id"],
                ("PENDING_APPROVAL",),
                new,
                user,
                {"eval_id": ap["eval_id"], "chosen_option_id": chosen_option_id},
            )
            state = new
        return {"ledger_seq": entry.seq, "case_state": state}

    return {
        "status": "OK",
        "approval_id": approval_id,
        "approval_status": new,
        **_transaction(session, work),
    }


# ------------------------------------------------------------------------ watchdog + stop
def enforce_deadlines(session: Any) -> dict[str, Any]:
    """Approvals past due (world clock) expire; the case falls back to the protective option."""
    now_world = world_now(session)
    due = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('case_id', a.case_id, 'rec_id', a.rec_id) FROM "
        f"{DEC}.APPROVALS a JOIN {DEC}.CASES c ON c.case_id = a.case_id WHERE a.status = "
        "'REQUESTED' "
        "AND c.state = 'PENDING_APPROVAL' AND a.due_at <= TO_TIMESTAMP_TZ(?) GROUP BY a.case_id, "
        "a.rec_id",
        [stages.iso(now_world)],
    )
    actor = _current_user(session)
    done = []
    for d in due:
        prepared = prepare_fallback(session, d["case_id"])

        def work(d=d, prepared=prepared):
            _exec(
                session,
                f"UPDATE {DEC}.APPROVALS SET status = 'EXPIRED', decided_at = CURRENT_TIMESTAMP(), "
                "reason = 'deadline passed (watchdog)' WHERE rec_id = ? AND status = 'REQUESTED'",
                [d["rec_id"]],
            )
            return record_fallback(
                session, d["case_id"], d["rec_id"], prepared, actor, stages.iso(now_world)
            )

        done.append({"case_id": d["case_id"], **_transaction(session, work)})
    return {"status": "OK", "world_now": stages.iso(now_world), "expired": done}


def prepare_fallback(session: Any, case_id: str) -> dict[str, Any]:
    """The protective fallback as a sealed decision: the engine's draft brief for the pack with the
    fallback option recommended (decided_by FALLBACK), and its policy evaluation."""
    from bbc_toolkit.stage_procs import _evaluate

    case = load_case(session, case_id)
    version, policy, _ = active_policy(session)
    pack = load_pack(session, case["current_pack_id"])
    _, run, start = _evaluate(session, case, pack, version, policy)
    ev = run(start)
    option = next(o for o in ev.options if o["is_fallback"])
    verdict = stages.evaluate_bundle(
        option,
        pack,
        policy,
        decider_kind="FALLBACK",
        value_at_risk_usd=float(case["value_at_risk_usd"] or 0),
    )
    return {
        "case": case,
        "pack": pack,
        "draft": ev.draft_brief,
        "option": option,
        "verdict": verdict,
        "policy_version": version,
    }


def record_fallback(session, case_id, expired_rec_id, prepared, actor, world_at) -> dict[str, Any]:
    from bbc_engine.engine import finalize_brief

    option, verdict, case = prepared["option"], prepared["verdict"], prepared["case"]
    rec_id = allocate_ids(session, "REC", 1)[0]
    eval_id = allocate_ids(session, "EVAL", 1)[0]
    decision = {
        "option_id": option["option_id"],
        "rec_id": rec_id,
        "decided_by": "FALLBACK",
        "decider_id": "WATCHDOG@1",
        "why_structured": ["APPROVAL_DEADLINE_PASSED", "PROTECTIVE_FALLBACK"],
        "narrative": f"No approval of {expired_rec_id} by its deadline; the protective fallback "
        f"({option['label']}) runs instead."[:4000],
    }
    brief = finalize_brief(prepared["draft"], decision)
    entry = ledger_append(
        session,
        entry_type="RECOMMENDATION",
        case_id=case_id,
        actor=actor,
        record_ref=f"{DEC}.RECOMMENDATIONS#{rec_id}",
        payload={
            "rec_id": rec_id,
            "option_id": option["option_id"],
            "decided_by": "FALLBACK",
            "decider_id": "WATCHDOG@1",
            "brief_hash": brief["brief_hash"],
            "supersedes": expired_rec_id,
            "world_now": world_at,
        },
    )
    _exec(
        session,
        f"UPDATE {DEC}.RECOMMENDATIONS SET status = 'SUPERSEDED' WHERE rec_id = ?",
        [expired_rec_id],
    )
    _exec(
        session,
        f"INSERT INTO {DEC}.RECOMMENDATIONS (rec_id, case_id, decision_point, option_id, "
        "decided_by, "
        "decider_id, escalation_reasons, brief, brief_hash, status, audit_status, created_at, "
        "ledger_seq) "
        "SELECT ?, ?, ?, ?, 'FALLBACK', 'WATCHDOG@1', PARSE_JSON('[]')::ARRAY, PARSE_JSON(?), ?, "
        "'ACTIVE', "
        "'NOT_REQUIRED', CURRENT_TIMESTAMP(), ?",
        [
            rec_id,
            case_id,
            case["decision_point"],
            option["option_id"],
            json.dumps(brief),
            brief["brief_hash"],
            entry.seq,
        ],
    )
    ev_entry = ledger_append(
        session,
        entry_type="POLICY_EVALUATION",
        case_id=case_id,
        actor=actor,
        record_ref=f"{DEC}.POLICY_EVALUATIONS#{eval_id}",
        payload={
            "eval_id": eval_id,
            "rec_id": rec_id,
            "policy_version": prepared["policy_version"],
            "outcome": verdict["outcome"],
            "autonomy_level": verdict["level"],
            "required_roles": [],
            "matched_rules": verdict["matched_rules"],
            "brief_hash": brief["brief_hash"],
            "evaluation_hash": ledger.canonical_hash(verdict),
        },
    )
    _exec(
        session,
        f"INSERT INTO {DEC}.POLICY_EVALUATIONS (eval_id, case_id, rec_id, policy_version, outcome, "
        "autonomy_level, required_roles, dual_approval, shadow, matched_rules, value_at_risk_usd, "
        "evaluation, "
        "created_at, ledger_seq) SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON('[]')::ARRAY, FALSE, ?, "
        "PARSE_JSON(?)::ARRAY, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), ?",
        [
            eval_id,
            case_id,
            rec_id,
            prepared["policy_version"],
            verdict["outcome"],
            verdict["level"],
            verdict["shadow"],
            json.dumps(verdict["matched_rules"]),
            case["value_at_risk_usd"],
            json.dumps(verdict),
            ev_entry.seq,
        ],
    )
    _exec(
        session,
        f"UPDATE {DEC}.CASES SET current_rec_id = ?, current_brief_hash = ? WHERE case_id = ?",
        [rec_id, brief["brief_hash"], case_id],
    )
    target = "AUTO_APPROVED" if verdict["outcome"] == "AUTO" else "DENIED"
    _set_case(
        session,
        case_id,
        ("PENDING_APPROVAL",),
        target,
        actor,
        {
            "rec_id": rec_id,
            "reason": "approval deadline passed: protective fallback",
            "world_now": world_at,
        },
    )
    return {
        "rec_id": rec_id,
        "eval_id": eval_id,
        "fallback_option_id": option["option_id"],
        "outcome": verdict["outcome"],
        "state": target,
    }


def emergency_stop(session: Any, reason: str) -> dict[str, Any]:
    if not reason or not reason.strip():
        return {"status": "INVALID", "errors": ["REASON is required"]}
    actor = _current_user(session)
    version, _, _ = active_policy(session)

    def work():
        entry = ledger_append(
            session,
            entry_type="EMERGENCY_STOP",
            case_id=None,
            actor=actor,
            record_ref="BBC_OS.GOV.EMERGENCY_STOPS",
            payload={"reason": reason, "policy_version": version},
        )
        _exec(
            session,
            "INSERT INTO BBC_OS.GOV.EMERGENCY_STOPS (stopped_at, stopped_by, reason, "
            "policy_version, ledger_seq) SELECT CURRENT_TIMESTAMP(), ?, ?, ?, ?",
            [actor, reason, version, entry.seq],
        )
        return {"ledger_seq": entry.seq}

    return {
        "status": "OK",
        "dispatch": "STOPPED",
        "resume": "activate a policy version",
        **_transaction(session, work),
    }


# ----------------------------------------------------------------------------- handlers
def _engine_only(session: Any) -> str | None:
    user = _current_user(session)
    roles = user_roles(session, user)
    if gateway.ENGINE_ROLE not in roles and "BBC_OWNER" not in roles:
        return f"{user} is not the engine principal"
    return None


def proc_mutate(session: Any, intent: Any):
    actor = _current_user(session)
    return _transaction(session, lambda: mutate(session, _as_obj(intent), actor=actor))


def proc_execute_plan(session: Any, case_id: str, rec_id: str):
    problem = _engine_only(session)
    return (
        {"status": "DENIED", "errors": [problem]}
        if problem
        else execute_plan(session, case_id, rec_id)
    )


def proc_next_actions(session: Any, dispatcher_id: str, limit: int, lease_s: int):
    if dispatch_stopped(session):
        return {"status": "STOPPED", "actions": []}
    return next_actions(session, dispatcher_id, limit, lease_s)


def proc_ack_mutation(session: Any, mutation_id: str, attempt: int, ack: Any):
    return ack_mutation(session, mutation_id, attempt, _as_obj(ack) or {})


def proc_decide_approval(
    session: Any, approval_id: str, verdict: str, chosen_option_id: str, reason: str
):
    return decide_approval(session, approval_id, verdict, chosen_option_id or None, reason)


def proc_enforce_deadlines(session: Any):
    return enforce_deadlines(session)


def proc_emergency_stop(session: Any, reason: str):
    return emergency_stop(session, reason)
