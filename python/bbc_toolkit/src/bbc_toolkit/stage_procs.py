"""Stage procedure handlers (WP6b): BUILD_ASSESSMENT, ROUTE, GENERATE_AND_SCORE_OPTIONS,
EVALUATE_POLICY, and the engine API ADVANCE_CASE / CLAIM_WORK.

Each stage runs in its own transaction: the record it writes, the case transition (checked
against the expected state, so a stage never runs twice) and its ledger entry commit together.
Canonical metric values are read through SEMANTIC_VIEW(BBC_OS.SEM.EXCURSION_RECOVERY ...); the
engine (bbc_engine) computes every option number from the sealed pack; policy comes from the
ACTIVE GOV.POLICY_VERSIONS document (its content hash is checked by snowflake/tests/02_policy.sql).
Pure logic lives in bbc_toolkit.stages.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from bbc_toolkit import ledger, stages
from bbc_toolkit.snow import _as_obj, _current_user, _exec, _one, _sql, allocate_ids, ledger_append

DEC = "BBC_OS.DECISION"
SV = "BBC_OS.SEM.EXCURSION_RECOVERY"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _ts(col: str) -> str:
    return f"TO_CHAR(CONVERT_TIMEZONE('UTC', {col}), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"


def _objs(session: Any, query: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    """Rows of a query whose single column is an OBJECT; keys lower-cased."""
    out = []
    for row in _sql(session, query, params).collect():
        value = _as_obj(next(iter(row)))
        out.append({str(k).lower(): v for k, v in (value or {}).items()})
    return out


def _in(values: list[str]) -> str:
    return "(" + ", ".join("?" for _ in values) + ")"


def _literal_ts(moment: datetime | str) -> str:
    """A validated timestamp literal (SEMANTIC_VIEW clauses take no bind variables)."""
    text = stages.iso(moment)
    if not ISO.match(text or ""):
        raise ValueError(f"not a UTC timestamp: {moment!r}")
    return f"'{text}'::TIMESTAMP_TZ"


def _now() -> str:
    return stages.iso(datetime.now(UTC))


# --------------------------------------------------------------------- governed inputs
def active_policy(session: Any) -> tuple[str, dict[str, Any], str]:
    row = _one(
        session,
        "SELECT policy_version, document, content_hash FROM BBC_OS.GOV.POLICY_VERSIONS "
        "WHERE status = 'ACTIVE'",
    )
    if row is None:
        raise RuntimeError("no ACTIVE policy")
    return str(row[0]), _as_obj(row[1]), str(row[2])


def reference(session: Any) -> dict[str, list[dict[str, Any]]]:
    tables = {
        "parties": "PARTIES",
        "sites": "SITES",
        "lanes": "LANES",
        "products": "PRODUCTS",
        "specs": "CUSTOMER_SPECS",
        "contracts": "CONTRACTS",
        "prices": "CHANNEL_PRICES",
        "cost_rates": "COST_RATES",
    }
    return {
        key: _objs(
            session,
            f"SELECT OBJECT_CONSTRUCT_KEEP_NULL(*) FROM BBC_OS.REF.{table} WHERE is_current",
        )
        for key, table in tables.items()
    }


def reference_versions(session: Any) -> dict[str, str]:
    row = _one(
        session,
        "SELECT (SELECT MAX(version) FROM BBC_OS.REF.PRODUCTS WHERE is_current), "
        "(SELECT MAX(version) FROM BBC_OS.REF.CONTRACTS WHERE is_current), "
        "(SELECT MAX(version) FROM BBC_OS.REF.CHANNEL_PRICES WHERE is_current), "
        "(SELECT MAX(version) FROM BBC_OS.REF.COST_RATES WHERE is_current), "
        "(SELECT MAX(version) FROM BBC_OS.REF.LANES WHERE is_current)",
    )
    return dict(
        zip(["products", "contracts", "prices", "cost_rates", "lanes"], map(str, row), strict=True)
    )


def engine_context(policy_version: str, policy: dict[str, Any], ref: dict[str, Any]):
    from bbc_engine.context import EngineContext

    return EngineContext(
        params=policy["parameters"],
        router_rules=policy["router_rules"],
        products={p["product_id"]: p for p in ref["products"]},
        contracts=ref["contracts"],
        cost_rates=ref["cost_rates"],
        lanes=ref["lanes"],
        sites={s["site_id"]: s for s in ref["sites"]},
        parties={p["party_id"]: p for p in ref["parties"]},
        policy_version=policy_version,
    )


def load_case(session: Any, case_id: str) -> dict[str, Any] | None:
    rows = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('case_id', case_id, 'decision_point', decision_point, "
        "'state', state, 'state_version', state_version, 'shipment_id', shipment_id, "
        "'current_pack_id', current_pack_id, 'current_rec_id', current_rec_id, "
        "'current_brief_hash', current_brief_hash, 'value_at_risk_usd', value_at_risk_usd, "
        f"'deadline_ts', {_ts('deadline_ts')}) FROM {DEC}.CASES WHERE case_id = ?",
        [case_id],
    )
    return rows[0] if rows else None


def load_pack(session: Any, pack_id: str) -> dict[str, Any]:
    row = _one(
        session, "SELECT pack FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS WHERE pack_id = ?", [pack_id]
    )
    if row is None:
        raise RuntimeError(f"no evidence pack {pack_id}")
    return _as_obj(row[0])


def load_pack_inputs(session: Any, case: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    """Everything BUILD_ASSESSMENT reads, as of the event-time watermark of the case's data."""
    case_id = case["case_id"]
    lot_ids = [
        str(r[0])
        for r in _sql(
            session,
            f"SELECT lot_id FROM {DEC}.CASE_LOTS WHERE case_id = ? ORDER BY lot_id",
            [case_id],
        ).collect()
    ]
    if not lot_ids:
        raise RuntimeError(f"{case_id} has no lots")
    # Canonical metrics, through the semantic view (the only definition of each).
    sv_lots = {
        r["lot_id"]: r
        for r in _objs(
            session,
            "SELECT OBJECT_CONSTRUCT_KEEP_NULL('lot_id', sv.lot_id, "
            "'remaining_shelf_life_days', sv.remaining_shelf_life_days, "
            "'monitoring_coverage_pct', sv.monitoring_coverage_pct, "
            "'temperature_compliance_pct', sv.temperature_compliance_pct, "
            f"'as_of', {_ts('lt.as_of')}) "
            f"FROM SEMANTIC_VIEW({SV} DIMENSIONS lots.lot_id METRICS "
            "lot_thermal.remaining_shelf_life_days, lot_thermal.monitoring_coverage_pct, "
            "lot_thermal.temperature_compliance_pct) sv "
            "JOIN BBC_OS.SEM.LOT_THERMAL lt ON lt.lot_id = sv.lot_id "
            f"WHERE sv.lot_id IN {_in(lot_ids)}",
            lot_ids,
        )
    }
    missing = [lot for lot in lot_ids if lot not in sv_lots]
    if missing:
        raise RuntimeError(f"no thermal state yet for {missing}")
    as_of = max(stages.parse_ts(v["as_of"]) for v in sv_lots.values())
    exposures = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('lot_id', sv.lot_id, 'holder_party_id', "
        "sv.holder_party_id, "
        "'excess_life_share', sv.excess_life_share, 'thermal_exposure_deg_h', "
        "sv.thermal_exposure_deg_h, "
        "'breach_min', ce.breach_min) "
        f"FROM SEMANTIC_VIEW({SV} DIMENSIONS lots.lot_id, holders.holder_party_id METRICS "
        "custody_exposure.excess_life_share, custody_exposure.thermal_exposure_deg_h) sv "
        "JOIN BBC_OS.SEM.CUSTODY_EXPOSURE ce ON ce.lot_id = sv.lot_id "
        "AND ce.holder_party_id = sv.holder_party_id "
        f"WHERE sv.lot_id IN {_in(lot_ids)} ORDER BY sv.lot_id, ce.first_reading_ts",
        lot_ids,
    )
    lots = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('lot_id', l.lot_id, 'product_id', l.product_id, 'kg', "
        "l.kg, "
        f"'grower_party_id', l.grower_party_id, 'harvest_at', {_ts('l.harvest_at')}, "
        "'harvest_site_id', l.harvest_site_id, 'probe_device_id', a.device_id) "
        "FROM BBC_OS.OPS.LOTS l LEFT JOIN BBC_OS.OPS.DEVICE_ASSIGNMENTS a ON a.target_id = "
        "l.lot_id "
        "AND a.target_type = 'LOT' AND a.role = 'PRIMARY' AND a.assigned_to IS NULL "
        f"WHERE l.lot_id IN {_in(lot_ids)} ORDER BY l.lot_id",
        lot_ids,
    )
    readings = _objs(
        session,
        f"SELECT OBJECT_CONSTRUCT_KEEP_NULL('lot_id', lot_id, 'reading_ts', {_ts('reading_ts')}, "
        "'interval_s', interval_s, 'pulp_c', pulp_c) FROM BBC_OS.OPS.TELEMETRY_ASSIGNED "
        f"WHERE lot_id IN {_in(lot_ids)} AND reading_ts <= TO_TIMESTAMP_TZ(?) "
        "ORDER BY lot_id, reading_ts",
        [*lot_ids, stages.iso(as_of)],
    )
    for lot in lots:
        lot["values"] = sv_lots[lot["lot_id"]]
        lot["exposures"] = [e for e in exposures if e["lot_id"] == lot["lot_id"]]
        lot["readings"] = [r for r in readings if r["lot_id"] == lot["lot_id"]]
    shipment_id = case["shipment_id"] or next(
        (
            str(r[0])
            for r in _sql(
                session,
                f"SELECT shipment_id FROM BBC_OS.OPS.SHIPMENT_LOTS WHERE lot_id IN {_in(lot_ids)}",
                lot_ids,
            ).collect()
        ),
        None,
    )
    shipment = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('shipment_id', s.shipment_id, "
        "'carrier_party_id', s.carrier_party_id, 'reefer_device_id', s.reefer_device_id, "
        "'origin_site_id', s.origin_site_id, 'destination_site_id', s.destination_site_id, "
        "'bol_setpoint_c', s.bol_setpoint_c, 'status', s.status, "
        f"'eta_at', {_ts('s.eta_at')}, 'planned_arrival_at', {_ts('s.planned_arrival_at')}, "
        f"'departed_at', {_ts('COALESCE(d.departed_at, s.planned_departure_at)')}) "
        "FROM BBC_OS.OPS.SHIPMENTS s LEFT JOIN (SELECT shipment_id, MIN(at) AS departed_at "
        "FROM BBC_OS.OPS.CUSTODY_EVENTS WHERE event_type = 'LOAD' GROUP BY shipment_id) d "
        "ON d.shipment_id = s.shipment_id WHERE s.shipment_id = ?",
        [shipment_id],
    )
    if not shipment:
        raise RuntimeError(f"{case_id}: no shipment for {lot_ids}")
    reefer = _objs(
        session,
        f"SELECT OBJECT_CONSTRUCT_KEEP_NULL('reading_ts', {_ts('reading_ts')}, 'mode', mode, "
        "'alarms', alarms, 'supply_air_c', supply_air_c, 'return_air_c', return_air_c, "
        "'setpoint_c', setpoint_c, 'ambient_c', ambient_c) FROM BBC_OS.OPS.REEFER_TELEMETRY "
        "WHERE shipment_id = ? AND reading_ts <= TO_TIMESTAMP_TZ(?) "
        "ORDER BY reading_ts DESC LIMIT 1",
        [shipment_id, stages.iso(as_of)],
    )
    order_lines = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('order_line_id', order_line_id, "
        "'customer_party_id', customer_party_id, 'product_id', product_id, 'kg', kg, "
        "'price_usd_per_kg', price_usd_per_kg, "
        f"'requested_delivery_at', {_ts('requested_delivery_at')}, "
        "'ship_to_site_id', ship_to_site_id, 'status', status, 'assigned_lot_id', assigned_lot_id) "
        f"FROM BBC_OS.OPS.ORDER_LINES WHERE assigned_lot_id IN {_in(lot_ids)} ORDER BY "
        "order_line_id",
        lot_ids,
    )
    # Replacement stock: quality-adjusted ATP at each site's latest snapshot up to as_of (the
    # governed semi-additive metric) and each lot's governed remaining shelf life.
    when = _literal_ts(as_of)
    atp = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('site_id', sv.site_id, 'lot_id', sv.lot_id, "
        f"'atp_kg', sv.quality_adjusted_atp_kg, 'snapshot_at', {_ts('p.snapshot_at')}, "
        "'product_id', p.product_id) "
        f"FROM SEMANTIC_VIEW({SV} DIMENSIONS sites.site_id, lots.lot_id "
        f"METRICS inventory.quality_adjusted_atp_kg WHERE inventory.snapshot_at <= {when}) sv "
        "JOIN (SELECT site_id, lot_id, MAX(snapshot_at) AS snapshot_at, ANY_VALUE(product_id) AS "
        "product_id "
        f"FROM BBC_OS.SEM.INVENTORY_POSITIONS WHERE snapshot_at <= {when} GROUP BY site_id, "
        "lot_id) p "
        "ON p.site_id = sv.site_id AND p.lot_id = sv.lot_id ORDER BY sv.site_id, sv.lot_id",
    )
    stock_lots = sorted({i["lot_id"] for i in atp})
    life = (
        {
            r["lot_id"]: r["remaining_shelf_life_days"]
            for r in _objs(
                session,
                "SELECT OBJECT_CONSTRUCT_KEEP_NULL('lot_id', lot_id, "
                "'remaining_shelf_life_days', remaining_shelf_life_days) "
                f"FROM SEMANTIC_VIEW({SV} DIMENSIONS lots.lot_id METRICS "
                f"lot_thermal.remaining_shelf_life_days) WHERE lot_id IN {_in(stock_lots)}",
                stock_lots,
            )
        }
        if stock_lots
        else {}
    )
    for item in atp:
        item["remaining_shelf_life_days"] = life.get(item["lot_id"])
    first = lots[0]
    timeline = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('party_id', c.to_party_id, "
        "'site_id', IFF(c.event_id IS NULL, ?, c.site_id), "
        f"'from_at', {_ts('IFF(c.event_id IS NULL, l.harvest_at, c.at)')}, 'to_at', "
        f"{_ts('c.next_at')}) "
        "FROM BBC_OS.OPS.LOT_CUSTODY_INTERVALS c JOIN BBC_OS.OPS.LOTS l ON l.lot_id = c.lot_id "
        "WHERE c.lot_id = ? ORDER BY c.at, c.event_id NULLS FIRST",
        [first["harvest_site_id"], first["lot_id"]],
    )
    return {
        "lots": lots,
        "shipment": shipment[0],
        "reefer": reefer[0] if reefer else None,
        "order_lines": order_lines,
        "inventory": atp,
        "timeline": timeline,
        "as_of": stages.iso(as_of),
    }


# ------------------------------------------------------------------------------- writes
def _transition(
    session: Any, case_id: str, from_state: str, to_state: str, sets: str = "", params=None
):
    """Move the case only if it is still in ``from_state`` (a stage never runs twice)."""
    rows = _sql(
        session,
        f"UPDATE {DEC}.CASES SET state = ?, state_version = state_version + 1, "
        f"updated_at = CURRENT_TIMESTAMP(){(', ' + sets) if sets else ''} "
        "WHERE case_id = ? AND state = ?",
        [to_state, *(params or []), case_id, from_state],
    ).collect()
    if not rows or int(next(iter(rows[0]))) != 1:
        raise RuntimeError(f"{case_id} is no longer {from_state}")


def _transaction(session: Any, work):
    _exec(session, "BEGIN")
    try:
        result = work()
        _exec(session, "COMMIT")
    except Exception:
        _exec(session, "ROLLBACK")
        raise
    return result


def build_assessment(session: Any, case_id: str, decision_point: str) -> dict[str, Any]:
    case = load_case(session, case_id)
    if case is None or case["state"] != "OPEN":
        return {"status": "INVALID", "errors": [f"{case_id} is not OPEN"]}
    import bbc_engine

    version, policy, _ = active_policy(session)
    ref = reference(session)
    inputs = load_pack_inputs(session, case, policy)
    actor = _current_user(session)

    def work():
        pack_id = allocate_ids(session, "PACK", 1)[0]
        revision = (
            int(
                _one(
                    session,
                    "SELECT COUNT(*) FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS "
                    "WHERE case_id = ? AND decision_point = ?",
                    [case_id, decision_point],
                )[0]
            )
            + 1
        )
        pack = stages.assemble_pack(
            {
                **inputs,
                "case_id": case_id,
                "pack_id": pack_id,
                "revision": revision,
                "decision_point": decision_point,
                "sealed_at": _now(),
                "param_versions": {
                    "policy": version,
                    "semantic": version,
                    "engine": bbc_engine.__version__,
                    **reference_versions(session),
                },
                "policy": policy,
                "ref": ref,
            }
        )
        due = stages.deadline(pack, policy)
        entry = ledger_append(
            session,
            entry_type="ASSESSMENT_SEALED",
            case_id=case_id,
            actor=actor,
            record_ref=f"BBC_OS.EVIDENCE.EVIDENCE_PACKS#{pack_id}",
            payload={
                "pack_id": pack_id,
                "revision": revision,
                "as_of": pack["as_of"],
                "content_hash": pack["content_hash"],
                "param_versions": pack["param_versions"],
                "values": {
                    lot["lot_id"]: {v["name"]: v["value"] for v in lot["values"]}
                    for lot in pack["lots"]
                },
            },
        )
        _exec(
            session,
            "INSERT INTO BBC_OS.EVIDENCE.EVIDENCE_PACKS (pack_id, case_id, decision_point, "
            "revision, "
            "as_of, sealed_at, content_hash, param_versions, pack, built_by, ledger_seq) "
            "SELECT ?, ?, ?, ?, TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), ?, PARSE_JSON(?), "
            "PARSE_JSON(?), ?, ?",
            [
                pack_id,
                case_id,
                decision_point,
                revision,
                pack["as_of"],
                pack["sealed_at"],
                pack["content_hash"],
                json.dumps(pack["param_versions"]),
                ledger.canonical_json(pack),
                actor,
                entry.seq,
            ],
        )
        for lot in pack["lots"]:
            _exec(
                session,
                f"UPDATE {DEC}.CASE_LOTS SET assessment = PARSE_JSON(?) WHERE case_id = ? AND "
                "lot_id = ?",
                [
                    json.dumps(
                        {
                            "pack_id": pack_id,
                            "values": lot["values"],
                            "custody_exposure": lot["custody_exposure"],
                        }
                    ),
                    case_id,
                    lot["lot_id"],
                ],
            )
        _transition(
            session,
            case_id,
            "OPEN",
            "ASSESSED",
            "current_pack_id = ?, deadline_ts = TO_TIMESTAMP_TZ(?), needs_reassessment = FALSE",
            [pack_id, stages.iso(due)],
        )
        return {"pack_id": pack_id, "content_hash": pack["content_hash"], "ledger_seq": entry.seq}

    return {"status": "OK", "state": "ASSESSED", **_transaction(session, work)}


def _transition_entry(session, case_id, actor, from_state, to_state, payload):
    return ledger_append(
        session,
        entry_type="TRANSITION",
        case_id=case_id,
        actor=actor,
        record_ref=f"{DEC}.CASES#{case_id}",
        payload={"case_id": case_id, "from": from_state, "to": to_state, **payload},
    )


def _evaluate(session, case, pack, policy_version, policy):
    """The engine over the sealed pack, numbering options from the block already stored."""
    from bbc_engine.engine import evaluate

    ref = reference(session)
    ctx = engine_context(policy_version, policy, ref)
    start = _one(
        session,
        f"SELECT MIN(TO_NUMBER(SUBSTR(option_id, 5))) FROM {DEC}.OPTIONS WHERE case_id = ? "
        "AND decision_point = ? AND pack_id = ?",
        [case["case_id"], case["decision_point"], pack["pack_id"]],
    )
    return (
        ctx,
        (lambda first: evaluate(pack, ctx, option_id_start=first)),
        (int(start[0]) if start and start[0] is not None else None),
    )


def route(session: Any, case_id: str, decision_point: str) -> dict[str, Any]:
    """ASSESSED: causal question -> Excursion Forensics, else a deterministic attribution.
    OPTIONS_SCORED: a clear winner -> rule recommendation, else the Recovery Strategist."""
    from bbc_engine.rank import RULE_ID, understanding_triggers

    case = load_case(session, case_id)
    if case is None:
        return {"status": "INVALID", "errors": [f"unknown case {case_id}"]}
    version, policy, _ = active_policy(session)
    pack = load_pack(session, case["current_pack_id"])
    actor = _current_user(session)

    if case["state"] == "ASSESSED":
        ctx = engine_context(version, policy, reference(session))
        triggers = sorted(set(understanding_triggers(pack, ctx)))
        if triggers:
            agents = sorted({ctx.router(t)["target_agent"] for t in triggers if ctx.router(t)})

            def escalate():
                _transition(session, case_id, "ASSESSED", "FORENSICS_PENDING")
                _transition_entry(
                    session,
                    case_id,
                    actor,
                    "ASSESSED",
                    "FORENSICS_PENDING",
                    {"triggers": triggers, "agents": agents, "pack_id": pack["pack_id"]},
                )

            _transaction(session, escalate)
            return {"status": "OK", "state": "FORENSICS_PENDING", "triggers": triggers}
        finding = stages.rule_finding(pack)

        def record():
            finding_id = allocate_ids(session, "FINDING", 1)[0]
            digest = ledger.canonical_hash(finding)
            entry = ledger_append(
                session,
                entry_type="FINDING",
                case_id=case_id,
                actor=actor,
                record_ref=f"{DEC}.CAUSATION_FINDINGS#{finding_id}",
                payload={
                    "finding_id": finding_id,
                    "decider_kind": "RULE",
                    "unadjudicated": True,
                    "finding_hash": digest,
                    "pack_id": pack["pack_id"],
                },
            )
            _exec(
                session,
                f"INSERT INTO {DEC}.CAUSATION_FINDINGS (finding_id, case_id, decision_point, "
                "revision, "
                "pack_id, decider_kind, status, unadjudicated, confidence, finding, finding_hash, "
                "created_at, created_by, ledger_seq) SELECT ?, ?, ?, ?, ?, 'RULE', 'ACCEPTED', "
                "TRUE, ?, "
                "PARSE_JSON(?), ?, CURRENT_TIMESTAMP(), ?, ?",
                [
                    finding_id,
                    case_id,
                    decision_point,
                    pack["revision"],
                    pack["pack_id"],
                    finding["confidence"],
                    json.dumps(finding),
                    digest,
                    actor,
                    entry.seq,
                ],
            )
            _transition(session, case_id, "ASSESSED", "FINDING_RECORDED")
            return {"finding_id": finding_id, "ledger_seq": entry.seq}

        return {"status": "OK", "state": "FINDING_RECORDED", **_transaction(session, record)}

    if case["state"] != "OPTIONS_SCORED":
        return {
            "status": "INVALID",
            "errors": [f"{case_id} is {case['state']}; ROUTE needs ASSESSED or OPTIONS_SCORED"],
        }
    stored = {
        str(r[0]): str(r[1])
        for r in _sql(
            session,
            f"SELECT option_id, option_hash FROM {DEC}.OPTIONS WHERE case_id = ? AND pack_id = ?",
            [case_id, pack["pack_id"]],
        ).collect()
    }
    ctx, run, start = _evaluate(session, case, pack, version, policy)

    # Re-evaluating the sealed pack must reproduce the stored options exactly (seeded engine).
    probe = run(start)
    replayed = {o["option_id"]: ledger.canonical_hash(o) for o in probe.options}
    if replayed != stored:
        raise RuntimeError(f"{case_id}: re-evaluation does not reproduce the stored options")
    if probe.decision is None:
        reasons = probe.escalation_reasons
        agents = sorted({ctx.router(t)["target_agent"] for t in reasons if ctx.router(t)})

        def escalate():
            _transition(session, case_id, "OPTIONS_SCORED", "STRATEGY_PENDING")
            _transition_entry(
                session,
                case_id,
                actor,
                "OPTIONS_SCORED",
                "STRATEGY_PENDING",
                {
                    "escalation_reasons": reasons,
                    "agents": agents,
                    "draft_brief_hash": ledger.canonical_hash(probe.draft_brief),
                },
            )

        _transaction(session, escalate)
        return {"status": "OK", "state": "STRATEGY_PENDING", "escalation_reasons": reasons}

    def recommend():
        from bbc_engine.engine import finalize_brief

        rec_id = allocate_ids(session, "REC", 1)[0]
        decision = {**probe.decision, "rec_id": rec_id}
        brief = finalize_brief(probe.draft_brief, decision)
        entry = ledger_append(
            session,
            entry_type="RECOMMENDATION",
            case_id=case_id,
            actor=actor,
            record_ref=f"{DEC}.RECOMMENDATIONS#{rec_id}",
            payload={
                "rec_id": rec_id,
                "option_id": decision["option_id"],
                "decided_by": "RULE",
                "decider_id": RULE_ID,
                "brief_hash": brief["brief_hash"],
                "pack_id": pack["pack_id"],
                "why_structured": decision["why_structured"],
            },
        )
        _exec(
            session,
            f"INSERT INTO {DEC}.RECOMMENDATIONS (rec_id, case_id, decision_point, option_id, "
            "decided_by, "
            "decider_id, escalation_reasons, brief, brief_hash, status, audit_status, created_at, "
            "ledger_seq) "
            "SELECT ?, ?, ?, ?, 'RULE', ?, PARSE_JSON(?)::ARRAY, PARSE_JSON(?), ?, 'ACTIVE', "
            "'NOT_REQUIRED', "
            "CURRENT_TIMESTAMP(), ?",
            [
                rec_id,
                case_id,
                decision_point,
                decision["option_id"],
                RULE_ID,
                "[]",
                json.dumps(brief),
                brief["brief_hash"],
                entry.seq,
            ],
        )
        _transition(
            session,
            case_id,
            "OPTIONS_SCORED",
            "RECOMMENDED",
            "current_rec_id = ?, current_brief_hash = ?",
            [rec_id, brief["brief_hash"]],
        )
        return {
            "rec_id": rec_id,
            "option_id": decision["option_id"],
            "brief_hash": brief["brief_hash"],
            "ledger_seq": entry.seq,
        }

    return {"status": "OK", "state": "RECOMMENDED", **_transaction(session, recommend)}


def generate_and_score_options(session: Any, case_id: str, decision_point: str) -> dict[str, Any]:
    from bbc_engine.engine import evaluate
    from bbc_engine.generator import generate

    case = load_case(session, case_id)
    if case is None or case["state"] != "FINDING_RECORDED":
        return {"status": "INVALID", "errors": [f"{case_id} is not FINDING_RECORDED"]}
    version, policy, _ = active_policy(session)
    pack = load_pack(session, case["current_pack_id"])
    ctx = engine_context(version, policy, reference(session))
    count = len(generate(pack, ctx))
    actor = _current_user(session)

    def work():
        ids = allocate_ids(session, "OPTION", count)
        ev = evaluate(pack, ctx, option_id_start=int(ids[0][4:]))
        if [o["option_id"] for o in ev.options] != ids:
            raise RuntimeError("option ids do not match the allocated block")
        default = next(o for o in ev.options if o["is_default"])
        planned = sum(float(lot["planned_value_usd"]) for lot in pack["lots"])
        value_at_risk = round(
            planned - float(default["outcome"]["financial"]["expected_nrv_usd"]), 2
        )
        hashes = {o["option_id"]: ledger.canonical_hash(o) for o in ev.options}
        entry = ledger_append(
            session,
            entry_type="OPTIONS_SCORED",
            case_id=case_id,
            actor=actor,
            record_ref=f"{DEC}.OPTIONS#{ids[0]}..{ids[-1]}",
            payload={
                "pack_id": pack["pack_id"],
                "options": hashes,
                "value_at_risk_usd": value_at_risk,
                "ranking": ev.draft_brief["comparison"]["ranking"],
                "escalation_reasons": ev.escalation_reasons,
                "understanding_triggers": ev.understanding_triggers,
            },
        )
        for o in ev.options:
            _exec(
                session,
                f"INSERT INTO {DEC}.OPTIONS (option_id, case_id, decision_point, option_set_rev, "
                "pack_id, "
                "option_key, origin, parent_option_id, is_default, is_fallback, feasible, "
                "score_rank, "
                "risk_adjusted_usd, expected_nrv_usd, expires_at, engine_version, seed, option, "
                "option_hash, "
                "created_at, ledger_seq) SELECT ?, ?, ?, ?, ?, ?, 'GENERATOR', NULL, ?, ?, ?, ?, "
                "?, ?, "
                "TO_TIMESTAMP_TZ(?), ?, ?, PARSE_JSON(?), ?, CURRENT_TIMESTAMP(), ?",
                [
                    o["option_id"],
                    case_id,
                    decision_point,
                    o["option_set_rev"],
                    pack["pack_id"],
                    ev.key_of(o["option_id"]),
                    o["is_default"],
                    o["is_fallback"],
                    o["feasible"],
                    o["score"]["rank"],
                    o["score"]["risk_adjusted_usd"],
                    o["outcome"]["financial"]["expected_nrv_usd"],
                    o["expires_at"],
                    o["provenance"]["engine_version"],
                    o["provenance"]["seed"],
                    json.dumps(o),
                    hashes[o["option_id"]],
                    entry.seq,
                ],
            )
        _transition(
            session,
            case_id,
            "FINDING_RECORDED",
            "OPTIONS_SCORED",
            "value_at_risk_usd = ?",
            [value_at_risk],
        )
        return {
            "options": len(ids),
            "value_at_risk_usd": value_at_risk,
            "ledger_seq": entry.seq,
            "escalation_reasons": ev.escalation_reasons,
        }

    return {"status": "OK", "state": "OPTIONS_SCORED", **_transaction(session, work)}


def audit_gate(session: Any, case_id: str) -> dict[str, Any]:
    """RECOMMENDED -> AUDITED when nothing AI-written needs the Evidence Integrity Auditor."""
    case = load_case(session, case_id)
    row = _one(
        session,
        f"SELECT audit_status, decided_by FROM {DEC}.RECOMMENDATIONS WHERE rec_id = ?",
        [case["current_rec_id"]],
    )
    if row is None:
        return {"status": "INVALID", "errors": ["no current recommendation"]}
    audit_status = str(row[0])
    target = "AUDITED" if audit_status in ("NOT_REQUIRED", "PASS") else "AUDIT_PENDING"
    actor = _current_user(session)

    def work():
        _transition(session, case_id, "RECOMMENDED", target)
        _transition_entry(
            session,
            case_id,
            actor,
            "RECOMMENDED",
            target,
            {
                "rec_id": case["current_rec_id"],
                "audit_status": audit_status,
                "decided_by": str(row[1]),
            },
        )

    _transaction(session, work)
    return {"status": "OK", "state": target}


def evaluate_policy(session: Any, rec_id: str) -> dict[str, Any]:
    rec = _objs(
        session,
        "SELECT OBJECT_CONSTRUCT_KEEP_NULL('rec_id', rec_id, 'case_id', case_id, 'option_id', "
        "option_id, "
        "'decided_by', decided_by, 'brief_hash', brief_hash, 'audit_status', audit_status) "
        f"FROM {DEC}.RECOMMENDATIONS WHERE rec_id = ?",
        [rec_id],
    )
    if not rec:
        return {"status": "INVALID", "errors": [f"unknown recommendation {rec_id}"]}
    rec = rec[0]
    case = load_case(session, rec["case_id"])
    if case["state"] != "AUDITED" or case["current_rec_id"] != rec_id:
        return {
            "status": "INVALID",
            "errors": [f"{case['case_id']} is {case['state']}; needs AUDITED"],
        }
    version, policy, _ = active_policy(session)
    pack = load_pack(session, case["current_pack_id"])
    option = _as_obj(
        _one(session, f"SELECT option FROM {DEC}.OPTIONS WHERE option_id = ?", [rec["option_id"]])[
            0
        ]
    )
    verdict = stages.evaluate_bundle(
        option,
        pack,
        policy,
        decider_kind=rec["decided_by"],
        value_at_risk_usd=float(case["value_at_risk_usd"] or 0),
        auditor_pass=(rec["audit_status"] == "PASS") if rec["decided_by"] == "AGENT" else None,
    )
    state = "SHADOW_RECORDED" if verdict["shadow"] else stages.POLICY_STATE[verdict["outcome"]]
    due = min(
        [stages.parse_ts(t) for t in (case["deadline_ts"], option["expires_at"]) if t],
        default=stages.parse_ts(pack["as_of"]) + timedelta(hours=24),
    )
    actor = _current_user(session)
    roles = verdict["required_roles"] if verdict["outcome"] in ("APPROVE", "HUMAN_INITIATE") else []

    def work():
        eval_id = allocate_ids(session, "EVAL", 1)[0]
        approval_ids = (
            allocate_ids(session, "APPROVAL", len(roles)) if roles and not verdict["shadow"] else []
        )
        entry = ledger_append(
            session,
            entry_type="POLICY_EVALUATION",
            case_id=case["case_id"],
            actor=actor,
            record_ref=f"{DEC}.POLICY_EVALUATIONS#{eval_id}",
            payload={
                "eval_id": eval_id,
                "rec_id": rec_id,
                "policy_version": version,
                "outcome": verdict["outcome"],
                "autonomy_level": verdict["level"],
                "required_roles": roles,
                "dual_approval": verdict["dual_approval"],
                "shadow": verdict["shadow"],
                "matched_rules": verdict["matched_rules"],
                "approval_ids": approval_ids,
                "brief_hash": rec["brief_hash"],
                "evaluation_hash": ledger.canonical_hash(verdict),
            },
        )
        _exec(
            session,
            f"INSERT INTO {DEC}.POLICY_EVALUATIONS (eval_id, case_id, rec_id, policy_version, "
            "outcome, "
            "autonomy_level, required_roles, dual_approval, shadow, matched_rules, "
            "value_at_risk_usd, "
            "evaluation, created_at, ledger_seq) SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?)::ARRAY, "
            "?, ?, "
            "PARSE_JSON(?)::ARRAY, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), ?",
            [
                eval_id,
                case["case_id"],
                rec_id,
                version,
                verdict["outcome"],
                verdict["level"],
                json.dumps(roles),
                verdict["dual_approval"],
                verdict["shadow"],
                json.dumps(verdict["matched_rules"]),
                case["value_at_risk_usd"],
                json.dumps(verdict),
                entry.seq,
            ],
        )
        for approval_id, role in zip(approval_ids, roles, strict=True):
            _exec(
                session,
                f"INSERT INTO {DEC}.APPROVALS (approval_id, case_id, eval_id, rec_id, "
                "required_role, status, "
                "requested_at, due_at, brief_hash_at_request, pack_hash_at_request, proposer, "
                "ledger_seq) "
                "SELECT ?, ?, ?, ?, ?, 'REQUESTED', CURRENT_TIMESTAMP(), TO_TIMESTAMP_TZ(?), ?, "
                "?, ?, ?",
                [
                    approval_id,
                    case["case_id"],
                    eval_id,
                    rec_id,
                    role,
                    stages.iso(due),
                    rec["brief_hash"],
                    pack["content_hash"],
                    actor,
                    entry.seq,
                ],
            )
        _transition(session, case["case_id"], "AUDITED", state)
        return {
            "eval_id": eval_id,
            "outcome": verdict["outcome"],
            "autonomy_level": verdict["level"],
            "required_roles": roles,
            "approval_ids": approval_ids,
            "ledger_seq": entry.seq,
        }

    return {"status": "OK", "state": state, **_transaction(session, work)}


# ----------------------------------------------------------------------------- handlers
def proc_build_assessment(session: Any, case_id: str, decision_point: str):
    return build_assessment(session, case_id, decision_point)


def proc_route(session: Any, case_id: str, decision_point: str):
    return route(session, case_id, decision_point)


def proc_generate_and_score_options(session: Any, case_id: str, decision_point: str):
    return generate_and_score_options(session, case_id, decision_point)


def proc_evaluate_policy(session: Any, rec_id: str):
    return evaluate_policy(session, rec_id)


def proc_advance_case(session: Any, case_id: str, expected_state: str):
    """API.ADVANCE_CASE: run the deterministic stages until the case waits for a person, an
    agent or the gateway. Idempotent: a stale expected state changes nothing."""
    case = load_case(session, case_id)
    if case is None:
        return {"status": "INVALID", "errors": [f"unknown case {case_id}"]}
    if case["state"] != expected_state:
        return {"status": "STALE", "case_id": case_id, "state": case["state"]}
    steps, state = [], case["state"]
    for _ in range(len(stages.ADVANCE_STEPS) + 1):
        step = stages.ADVANCE_STEPS.get(state)
        if step is None:
            break
        dp = case["decision_point"]
        if step == "BUILD_ASSESSMENT":
            result = build_assessment(session, case_id, dp)
        elif step == "ROUTE":
            result = route(session, case_id, dp)
        elif step == "GENERATE_AND_SCORE_OPTIONS":
            result = generate_and_score_options(session, case_id, dp)
        elif step == "AUDIT_GATE":
            result = audit_gate(session, case_id)
        else:
            result = evaluate_policy(session, load_case(session, case_id)["current_rec_id"])
        if result.get("status") != "OK":
            return {
                "status": result.get("status"),
                "case_id": case_id,
                "state": state,
                "steps": steps,
                "errors": result.get("errors"),
            }
        steps.append({"step": step, **{k: v for k, v in result.items() if k != "status"}})
        state = result["state"]
    return {
        "status": "OK",
        "case_id": case_id,
        "from": expected_state,
        "state": state,
        "steps": steps,
        "waiting_for": list(stages.WAITING_FOR.get(state, ())),
    }


def proc_claim_work(session: Any, worker_id: str, lease_s: int):
    """API.CLAIM_WORK: lease the oldest case that needs a step (expired leases are reclaimed)."""
    states = list(stages.ADVANCE_STEPS) + list(stages.WAITING_FOR)
    placeholders = _in(states)

    def work():
        _exec(
            session,
            f"UPDATE {DEC}.CASES SET lease_owner = ?, "
            "lease_until = DATEADD('second', ?, CURRENT_TIMESTAMP()) WHERE case_id = ("
            f"SELECT case_id FROM {DEC}.CASES WHERE state IN {placeholders} AND state <> "
            "'PENDING_APPROVAL' "
            "AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP() OR lease_owner = ?) "
            "ORDER BY needs_reassessment DESC, opened_at, case_id LIMIT 1)",
            [worker_id, int(lease_s), *states, worker_id],
        )
        row = _one(
            session,
            f"SELECT case_id, state, state_version FROM {DEC}.CASES WHERE lease_owner = ? "
            "AND lease_until > CURRENT_TIMESTAMP() ORDER BY updated_at DESC LIMIT 1",
            [worker_id],
        )
        return row

    row = _transaction(session, work)
    if row is None:
        return {"status": "OK", "case_id": None}
    state = str(row[1])
    if state in stages.ADVANCE_STEPS:
        nxt = {"kind": "ADVANCE", "call": "API.ADVANCE_CASE", "expected_state": state}
    else:
        kind, target = stages.WAITING_FOR[state]
        nxt = {"kind": kind, "target": target, "expected_state": state}
    return {
        "status": "OK",
        "case_id": str(row[0]),
        "state": state,
        "state_version": int(row[2]),
        "next": nxt,
    }
