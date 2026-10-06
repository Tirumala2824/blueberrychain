"""Server-side checks for RAW ingest batches (``API.INGEST_BATCH``).

Connectors compute idempotency keys themselves (``bbc_toolkit.raw`` /
``@blueberrychain/shared``), but the server never trusts them: every row is validated
against its contract and its key is recomputed. Rows that fail go to
``RAW.INGEST_ERRORS`` with the reasons, so a data gap is an auditable fact rather
than a silent loss. Valid rows are de-duplicated within the batch here and against
the table by the MERGE, so a re-sent batch inserts nothing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from bbc_toolkit import contracts, raw

TARGETS = {
    "TELEMETRY": "raw/telemetry_reading.json",
    "BUSINESS_EVENTS": "raw/business_event.json",
}
MAX_ROWS = 5000
CONNECTOR_ID = re.compile(r"^[a-z][a-z0-9-]{1,63}$")
STREAM = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
SQL_TS_FORMAT = "YYYY-MM-DD HH24:MI:SS.FF6 TZH:TZM"


def sql_ts(text: str) -> str:
    """UTC timestamp in the explicit format ``TO_TIMESTAMP_TZ(x, SQL_TS_FORMAT)`` parses."""
    moment = datetime.strptime(raw.normalize_ts(text), "%Y-%m-%dT%H:%M:%S.%fZ")
    return moment.strftime("%Y-%m-%d %H:%M:%S.%f") + " +00:00"


@dataclass
class Prepared:
    rows: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)
    duplicates_in_batch: int = 0


def batch_problems(target: str, connector_id: str, rows: Any, stream: str) -> list[str]:
    """Batch-level problems; any of these rejects the whole call and writes nothing."""
    problems = []
    if target not in TARGETS:
        problems.append(f"TARGET must be one of {sorted(TARGETS)}")
    if not isinstance(connector_id, str) or not CONNECTOR_ID.match(connector_id):
        problems.append("CONNECTOR_ID must match ^[a-z][a-z0-9-]{1,63}$")
    if not isinstance(rows, list) or not rows:
        problems.append("ROWS must be a non-empty array")
    elif len(rows) > MAX_ROWS:
        problems.append(f"ROWS has {len(rows)} rows; the limit is {MAX_ROWS}")
    if stream and not STREAM.match(stream):
        problems.append("STREAM must match ^[A-Za-z0-9_.:-]{1,64}$ (or be empty)")
    return problems


def _expected_key(target: str, row: dict[str, Any]) -> str:
    if target == "TELEMETRY":
        return raw.telemetry_key(row["device_id"], row["reading_ts"])
    return raw.business_event_key(
        row["source_system"], row["entity_type"], row["external_id"], row["event_ts"]
    )


def _table_row(target: str, row: dict[str, Any]) -> dict[str, Any]:
    provenance = row.get("provenance", "LIVE")
    if target == "TELEMETRY":
        return {
            "device_id": row["device_id"],
            "reading_ts": sql_ts(row["reading_ts"]),
            "interval_s": row["interval_s"],
            "readings": row["readings"],
            "idempotency_key": row["idempotency_key"],
            "provenance": provenance,
        }
    return {
        "source_system": row["source_system"],
        "entity_type": row["entity_type"],
        "external_id": row["external_id"],
        "event_ts": sql_ts(row["event_ts"]),
        "payload": row["payload"],
        "idempotency_key": row["idempotency_key"],
        "provenance": provenance,
    }


def prepare(target: str, connector_id: str, rows: list[Any]) -> Prepared:
    """Validate every row; return the de-duplicated table rows and the rejects."""
    out = Prepared()
    seen: set[str] = set()
    for index, row in enumerate(rows):
        errors = [f"{e.path or '/'}: {e.message}" for e in contracts.validate(TARGETS[target], row)]
        if not errors:
            if row["connector_id"] != connector_id:
                errors.append(
                    f"/connector_id: {row['connector_id']} does not match "
                    f"the caller's {connector_id}"
                )
            try:
                expected = _expected_key(target, row)
            except ValueError as exc:
                errors.append(f"timestamp: {exc}")
            else:
                if row["idempotency_key"] != expected:
                    errors.append(f"/idempotency_key: expected {expected}")
        if errors:
            out.rejected.append({"index": index, "errors": errors, "row": row})
            continue
        key = row["idempotency_key"]
        if key in seen:
            out.duplicates_in_batch += 1
            continue
        seen.add(key)
        out.rows.append(_table_row(target, row))
    return out
