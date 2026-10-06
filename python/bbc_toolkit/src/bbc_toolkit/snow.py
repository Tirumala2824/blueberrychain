"""Snowflake procedure / UDF handlers (run inside Snowpark; tested locally with a fake session).

Every handler here is referenced directly by a ``HANDLER = 'bbc_toolkit.snow.<name>'``
clause, so Snowflake runs exactly this tested code. Handlers use only
``session.sql(query, params=...).collect()`` and positional row access.

Transactions: each top-level procedure opens one transaction, does its writes
and its ledger append inside it, and commits - the record and its ledger entry
land together or not at all. ``ledger_append`` never opens a transaction itself.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from bbc_toolkit import ingest, ledger, reference
from bbc_toolkit.policy import check_policy

HEAD = "BBC_OS.LEDGER.HEAD"
ENTRIES = "BBC_OS.LEDGER.ENTRIES"
GOV = "BBC_OS.GOV"


def _as_obj(value: Any) -> Any:
    """VARIANT arguments may arrive as JSON text depending on the call path."""
    return json.loads(value) if isinstance(value, str) else value


def _one(session: Any, query: str, params: list[Any] | None = None) -> tuple | None:
    rows = session.sql(query, params=params or []).collect()
    return tuple(rows[0]) if rows else None


def _exec(session: Any, query: str, params: list[Any] | None = None) -> None:
    session.sql(query, params=params or []).collect()


def _current_user(session: Any) -> str:
    row = _one(session, "SELECT CURRENT_USER()")
    return str(row[0]) if row else "UNKNOWN"


# --------------------------------------------------------------------------- ledger
def ledger_append(
    session: Any, *, entry_type: str, case_id: str | None, actor: str, record_ref: str, payload: Any
) -> ledger.LedgerEntry:
    """Append one chained entry. Must run inside the caller's open transaction.

    The UPDATE on the single HEAD row takes its lock, so concurrent appenders
    queue behind each other until commit (WP1 spike S10).
    """
    _exec(session, f"UPDATE {HEAD} SET last_seq = last_seq + 1 WHERE id = 1")
    row = _one(session, f"SELECT last_seq, last_hash FROM {HEAD} WHERE id = 1")
    if row is None:
        raise RuntimeError("LEDGER.HEAD is not initialised")
    entry = ledger.make_entry(
        seq=int(row[0]),
        ts=ledger.iso_utc(datetime.now(UTC)),
        entry_type=entry_type,
        case_id=case_id,
        actor=actor,
        record_ref=record_ref,
        payload=payload,
        prev_hash=str(row[1]),
    )
    _exec(
        session,
        f"INSERT INTO {ENTRIES} (seq, ts, ts_tz, entry_type, case_id, actor, record_ref, payload, "
        "payload_hash, prev_hash, entry_hash) "
        "SELECT ?, ?, TO_TIMESTAMP_TZ(?), ?, ?, ?, ?, PARSE_JSON(?), ?, ?, ?",
        [
            entry.seq,
            entry.ts,
            entry.ts,
            entry.entry_type,
            entry.case_id,
            entry.actor,
            entry.record_ref,
            ledger.canonical_json(payload),
            entry.payload_hash,
            entry.prev_hash,
            entry.entry_hash,
        ],
    )
    _exec(session, f"UPDATE {HEAD} SET last_hash = ? WHERE id = 1", [entry.entry_hash])
    return entry


def proc_ledger_append(
    session: Any, entry_type: str, case_id: str, actor: str, record_ref: str, payload: Any
):
    """LEDGER.APPEND for SQL callers: one entry in its own transaction."""
    _exec(session, "BEGIN")
    try:
        entry = ledger_append(
            session,
            entry_type=entry_type,
            case_id=case_id or None,
            actor=actor,
            record_ref=record_ref,
            payload=_as_obj(payload),
        )
        _exec(session, "COMMIT")
    except Exception:
        _exec(session, "ROLLBACK")
        raise
    return {"status": "OK", "seq": entry.seq, "entry_hash": entry.entry_hash}


def udf_canonical_hash(payload: Any) -> str:
    """LEDGER.CANONICAL_HASH(VARIANT) - identical canonicalization to every writer."""
    return ledger.canonical_hash(payload)


# ------------------------------------------------------------------ reference data
def _key_str(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def proc_apply_reference_change(session: Any, entity_type: str, records: Any, reason: str):
    records = _as_obj(records)
    if not isinstance(records, list) or not records:
        return {"status": "INVALID", "errors": ["RECORDS must be a non-empty array"]}
    try:
        ent = reference.entity(entity_type)
    except KeyError as exc:
        return {"status": "INVALID", "errors": [str(exc)]}
    if not reason or not reason.strip():
        return {"status": "INVALID", "errors": ["REASON is required"]}
    problems = reference.validate_batch(entity_type, records)
    if problems:
        return {"status": "INVALID", "errors": problems[:50]}

    batch_id = "REFB-" + ledger.canonical_hash({"entity": entity_type, "records": records})[:16]
    key_cols = ", ".join(ent.key)
    insert, cols = reference.insert_sql(entity_type)
    json_cols = reference.json_columns(entity_type)
    actor = _current_user(session)

    _exec(session, "BEGIN")
    try:
        rows = session.sql(
            f"SELECT {key_cols}, version, record_hash FROM {ent.table} WHERE is_current"
        ).collect()
        n = len(ent.key)
        current = {
            tuple(_key_str(v) for v in tuple(r)[:n]): (int(tuple(r)[n]), str(tuple(r)[n + 1]))
            for r in rows
        }
        normalized = [{**r, **{k: _key_str(r[k]) for k in ent.key}} for r in records]
        changes, unchanged = reference.plan_changes(entity_type, normalized, current)
        if not changes:  # nothing changed, so nothing to record
            _exec(session, "COMMIT")
            return {
                "status": "OK",
                "entity_type": entity_type,
                "batch_id": batch_id,
                "inserted": 0,
                "unchanged": unchanged,
                "ledger_seq": None,
            }
        for change in changes:
            key_params = list(change.key)
            if change.previous_version is not None:
                _exec(
                    session,
                    f"UPDATE {ent.table} SET is_current = FALSE, valid_to = CURRENT_TIMESTAMP() "
                    f"WHERE {reference.key_predicate(entity_type)} AND is_current",
                    key_params,
                )
            values = [
                json.dumps(change.record.get(c))
                if c in json_cols and change.record.get(c) is not None
                else change.record.get(c)
                for c in cols
            ]
            version = (change.previous_version or 0) + 1
            _exec(session, insert, [*values, version, reason, change.record_hash, batch_id])
        entry = ledger_append(
            session,
            entry_type="REFERENCE_CHANGED",
            case_id=None,
            actor=actor,
            record_ref=f"{ent.table}#{batch_id}",
            payload={
                "entity_type": entity_type,
                "batch_id": batch_id,
                "reason": reason,
                "inserted": len(changes),
                "unchanged": unchanged,
                "changed_keys": [list(c.key) for c in changes],
                "records_hash": ledger.canonical_hash(records),
            },
        )
        _exec(session, "COMMIT")
    except Exception:
        _exec(session, "ROLLBACK")
        raise
    return {
        "status": "OK",
        "entity_type": entity_type,
        "batch_id": batch_id,
        "inserted": len(changes),
        "unchanged": unchanged,
        "ledger_seq": entry.seq,
    }


# ---------------------------------------------------------------------------- policy
SECTION_INSERTS: dict[str, tuple[str, list[str]]] = {
    "decision_rights": (
        f"INSERT INTO {GOV}.DECISION_RIGHTS (policy_version, rule_id, priority, conditions, "
        "outcome, required_roles, note) "
        "SELECT ?, ?, ?, PARSE_JSON(?), ?, PARSE_JSON(?)::ARRAY, ?",
        ["rule_id", "priority", "conditions", "outcome", "required_roles", "note"],
    ),
    "router_rules": (
        f"INSERT INTO {GOV}.ROUTER_RULES (policy_version, trigger_code, enabled, target_agent, "
        "params) "
        "SELECT ?, ?, ?, ?, PARSE_JSON(?)",
        ["trigger", "enabled", "target_agent", "params"],
    ),
    "hard_limits": (
        f"INSERT INTO {GOV}.HARD_LIMITS (policy_version, limit_id, product_id, max_pulp_c, "
        "max_minutes_above, consequence) "
        "SELECT ?, ?, ?, ?, ?, ?",
        ["limit_id", "product_id", "max_pulp_c", "max_minutes_above", "consequence"],
    ),
    "action_types": (
        f"INSERT INTO {GOV}.ACTION_TYPES (policy_version, action_type, target_system, "
        "reversibility, max_level, compensation, preconditions) "
        "SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?)::ARRAY",
        [
            "action_type",
            "target_system",
            "reversibility",
            "max_level",
            "compensation",
            "preconditions",
        ],
    ),
    "model_registry": (
        f"INSERT INTO {GOV}.MODEL_REGISTRY (policy_version, agent, provider, model, role, "
        "data_classes, must_differ_from_author) "
        "SELECT ?, ?, ?, ?, ?, PARSE_JSON(?)::ARRAY, ?",
        ["agent", "provider", "model", "role", "data_classes", "must_differ_from_author"],
    ),
    "metric_registry": (
        f"INSERT INTO {GOV}.METRIC_REGISTRY (policy_version, name, version, canonical, unit, "
        "grain, owner_role, staleness_limit_min, allowed_dimensions) "
        "SELECT ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?)::ARRAY",
        [
            "name",
            "version",
            "canonical",
            "unit",
            "grain",
            "owner_role",
            "staleness_limit_min",
            "allowed_dimensions",
        ],
    ),
}
JSON_FIELDS = {
    "conditions",
    "required_roles",
    "params",
    "preconditions",
    "data_classes",
    "allowed_dimensions",
}
SECTION_TABLES = [
    "DECISION_RIGHTS",
    "ROUTER_RULES",
    "HARD_LIMITS",
    "ACTION_TYPES",
    "MODEL_REGISTRY",
    "METRIC_REGISTRY",
    "PARAMETERS",
    "AUTONOMY_THRESHOLDS",
]


def _bind(row: dict[str, Any], field: str) -> Any:
    value = row.get(field)
    if field in JSON_FIELDS:
        default = {} if field in ("conditions", "params") else []
        return json.dumps(value if value is not None else default)
    return value


def _insert_policy_rows(session: Any, version: str, doc: dict[str, Any]) -> None:
    for section, (sql, fields) in SECTION_INSERTS.items():
        for row in doc[section]:
            _exec(session, sql, [version, *[_bind(row, f) for f in fields]])
    for key, value in doc["parameters"].items():
        _exec(
            session,
            f"INSERT INTO {GOV}.PARAMETERS (policy_version, param_key, param_value) SELECT ?, ?, "
            "PARSE_JSON(?)",
            [version, key, json.dumps(value)],
        )
    for dimension, bands in doc["autonomy_thresholds"].items():
        for ordinal, band in enumerate(bands, start=1):
            _exec(
                session,
                f"INSERT INTO {GOV}.AUTONOMY_THRESHOLDS (policy_version, dimension, ordinal, "
                "metric, l3_max, l4_max, "
                "beyond_l4, approver_roles) SELECT ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?), ?, "
                "PARSE_JSON(?)::ARRAY",
                [
                    version,
                    dimension,
                    ordinal,
                    band["metric"],
                    json.dumps(band["l3_max"]),
                    json.dumps(band["l4_max"]),
                    band.get("beyond_l4"),
                    json.dumps(band.get("approver_roles", [])),
                ],
            )


def proc_draft_policy(session: Any, document: Any):
    doc = _as_obj(document)
    problems = check_policy(doc) if isinstance(doc, dict) else ["DOCUMENT must be a JSON object"]
    if problems:
        return {"status": "INVALID", "errors": problems[:50]}
    version = doc["policy_version"]
    existing = _one(
        session, f"SELECT status FROM {GOV}.POLICY_VERSIONS WHERE policy_version = ?", [version]
    )
    if existing and existing[0] != "DRAFT":
        return {
            "status": "INVALID",
            "errors": [f"policy {version} is {existing[0]}; only drafts can be replaced"],
        }
    content_hash = ledger.canonical_hash(doc)
    actor = _current_user(session)

    _exec(session, "BEGIN")
    try:
        if existing:
            for table in SECTION_TABLES:
                _exec(session, f"DELETE FROM {GOV}.{table} WHERE policy_version = ?", [version])
            _exec(
                session,
                f"DELETE FROM {GOV}.POLICY_VERSIONS WHERE policy_version = ? AND status = 'DRAFT'",
                [version],
            )
        _exec(
            session,
            f"INSERT INTO {GOV}.POLICY_VERSIONS (policy_version, status, document, content_hash, "
            "description, "
            "drafted_by, drafted_at) SELECT ?, 'DRAFT', PARSE_JSON(?), ?, ?, CURRENT_USER(), "
            "CURRENT_TIMESTAMP()",
            [version, ledger.canonical_json(doc), content_hash, doc["description"]],
        )
        _insert_policy_rows(session, version, doc)
        entry = ledger_append(
            session,
            entry_type="POLICY_DRAFTED",
            case_id=None,
            actor=actor,
            record_ref=f"{GOV}.POLICY_VERSIONS#{version}",
            payload={
                "policy_version": version,
                "content_hash": content_hash,
                "replaced_draft": bool(existing),
            },
        )
        _exec(session, "COMMIT")
    except Exception:
        _exec(session, "ROLLBACK")
        raise
    return {
        "status": "OK",
        "policy_version": version,
        "content_hash": content_hash,
        "ledger_seq": entry.seq,
    }


def proc_activate_policy(session: Any, policy_version: str, reason: str):
    if not reason or not reason.strip():
        return {"status": "INVALID", "errors": ["REASON is required"]}
    row = _one(
        session,
        f"SELECT status, document, content_hash, drafted_by FROM {GOV}.POLICY_VERSIONS WHERE "
        "policy_version = ?",
        [policy_version],
    )
    if row is None:
        return {"status": "INVALID", "errors": [f"policy {policy_version} not found"]}
    status, document, content_hash, drafted_by = row
    if status != "DRAFT":
        return {"status": "INVALID", "errors": [f"policy {policy_version} is {status}, not DRAFT"]}
    doc = _as_obj(document)
    if ledger.canonical_hash(doc) != content_hash:
        return {
            "status": "INVALID",
            "errors": ["stored policy document does not match its content hash"],
        }
    problems = check_policy(doc)
    if problems:
        return {"status": "INVALID", "errors": problems[:50]}
    actor = _current_user(session)
    if actor == drafted_by:
        return {
            "status": "DENIED",
            "errors": ["separation of duties: the drafter cannot activate the same policy"],
        }
    previous = _one(
        session, f"SELECT policy_version FROM {GOV}.POLICY_VERSIONS WHERE status = 'ACTIVE'"
    )

    _exec(session, "BEGIN")
    try:
        _exec(
            session,
            f"UPDATE {GOV}.POLICY_VERSIONS SET status = 'RETIRED', retired_at = "
            "CURRENT_TIMESTAMP() "
            "WHERE status = 'ACTIVE'",
        )
        _exec(
            session,
            f"UPDATE {GOV}.POLICY_VERSIONS SET status = 'ACTIVE', activated_by = CURRENT_USER(), "
            "activated_at = CURRENT_TIMESTAMP(), activation_reason = ? "
            "WHERE policy_version = ? AND status = 'DRAFT'",
            [reason, policy_version],
        )
        entry = ledger_append(
            session,
            entry_type="POLICY_ACTIVATED",
            case_id=None,
            actor=actor,
            record_ref=f"{GOV}.POLICY_VERSIONS#{policy_version}",
            payload={
                "policy_version": policy_version,
                "content_hash": content_hash,
                "previous_version": previous[0] if previous else None,
                "reason": reason,
            },
        )
        _exec(session, "COMMIT")
    except Exception:
        _exec(session, "ROLLBACK")
        raise
    return {
        "status": "OK",
        "policy_version": policy_version,
        "previous_version": previous[0] if previous else None,
        "ledger_seq": entry.seq,
    }


# ---------------------------------------------------------------------------- ingest
RAW = "BBC_OS.RAW"
_FLATTEN = "FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?))) f"
_TS = f"TO_TIMESTAMP_TZ(f.value:{{col}}::STRING, '{ingest.SQL_TS_FORMAT}')"
MERGE_SQL = {
    "TELEMETRY": (
        f"MERGE INTO {RAW}.TELEMETRY t USING ("
        "SELECT f.value:device_id::STRING AS device_id, "
        f"{_TS.format(col='reading_ts')} AS reading_ts, "
        "f.value:interval_s::NUMBER(5,0) AS interval_s, f.value:readings AS readings, "
        "f.value:idempotency_key::STRING AS idempotency_key, "
        f"f.value:provenance::STRING AS provenance {_FLATTEN}"
        ") s ON t.idempotency_key = s.idempotency_key "
        "WHEN NOT MATCHED THEN INSERT "
        "(device_id, reading_ts, interval_s, readings, idempotency_key, connector_id, provenance) "
        "VALUES (s.device_id, s.reading_ts, s.interval_s, s.readings, s.idempotency_key, ?, "
        "s.provenance)"
    ),
    "BUSINESS_EVENTS": (
        f"MERGE INTO {RAW}.BUSINESS_EVENTS t USING ("
        "SELECT f.value:source_system::STRING AS source_system, "
        "f.value:entity_type::STRING AS entity_type, f.value:external_id::STRING AS external_id, "
        f"{_TS.format(col='event_ts')} AS event_ts, f.value:payload AS payload, "
        "f.value:idempotency_key::STRING AS idempotency_key, "
        f"f.value:provenance::STRING AS provenance {_FLATTEN}"
        ") s ON t.idempotency_key = s.idempotency_key "
        "WHEN NOT MATCHED THEN INSERT "
        "(source_system, entity_type, external_id, event_ts, payload, idempotency_key, "
        "connector_id, provenance) "
        "VALUES (s.source_system, s.entity_type, s.external_id, s.event_ts, s.payload, "
        "s.idempotency_key, ?, s.provenance)"
    ),
}
INSERT_ERRORS = (
    f"INSERT INTO {RAW}.INGEST_ERRORS (connector_id, target, payload, errors) "
    f"SELECT ?, ?, f.value:row, f.value:errors {_FLATTEN}"
)
MERGE_CURSOR = (
    f"MERGE INTO {RAW}.CONNECTOR_STATE t USING (SELECT ? AS connector_id, ? AS stream, "
    "? AS cursor_value) s ON t.connector_id = s.connector_id AND t.stream = s.stream "
    "WHEN MATCHED THEN UPDATE SET cursor_value = s.cursor_value, updated_at = CURRENT_TIMESTAMP() "
    "WHEN NOT MATCHED THEN INSERT (connector_id, stream, cursor_value) "
    "VALUES (s.connector_id, s.stream, s.cursor_value)"
)
REJECTS_RETURNED = 100


def proc_ingest_batch(
    session: Any, target: str, connector_id: str, rows: Any, stream: str, cursor_value: str
):
    """Land a batch in RAW: validate, MERGE on idempotency key, dead-letter the rejects and
    advance the connector cursor - all in one transaction, so a cursor never moves past
    rows that were not committed."""
    rows = _as_obj(rows)
    problems = ingest.batch_problems(target, connector_id, rows, stream or "")
    if problems:
        return {"status": "INVALID", "errors": problems}
    prepared = ingest.prepare(target, connector_id, rows)

    _exec(session, "BEGIN")
    try:
        inserted = 0
        if prepared.rows:
            result = session.sql(
                MERGE_SQL[target], params=[json.dumps(prepared.rows), connector_id]
            ).collect()
            inserted = int(next(iter(result[0]))) if result else 0
        if prepared.rejected:
            dead = [{"row": r["row"], "errors": r["errors"]} for r in prepared.rejected]
            _exec(session, INSERT_ERRORS, [connector_id, target, json.dumps(dead)])
        if stream:
            _exec(session, MERGE_CURSOR, [connector_id, stream, cursor_value or None])
        _exec(session, "COMMIT")
    except Exception:
        _exec(session, "ROLLBACK")
        raise
    return {
        "status": "PARTIAL" if prepared.rejected else "OK",
        "target": target,
        "received": len(rows),
        "inserted": inserted,
        "duplicates": prepared.duplicates_in_batch + len(prepared.rows) - inserted,
        "rejected": len(prepared.rejected),
        "rejects": [
            {"index": r["index"], "errors": r["errors"]}
            for r in prepared.rejected[:REJECTS_RETURNED]
        ],
        "stream": stream or None,
        "cursor_value": (cursor_value or None) if stream else None,
    }


def proc_get_connector_state(session: Any, connector_id: str):
    rows = session.sql(
        f"SELECT stream, cursor_value, updated_at FROM {RAW}.CONNECTOR_STATE "
        "WHERE connector_id = ? ORDER BY stream",
        params=[connector_id],
    ).collect()
    return {
        "status": "OK",
        "connector_id": connector_id,
        "streams": {
            str(r[0]): {"cursor_value": r[1], "updated_at": _key_str(r[2])}
            for r in map(tuple, rows)
        },
    }
