"""Idempotency keys for RAW rows (the sink MERGEs on them, so retries never duplicate).

Keys are the canonical hash (see ``bbc_toolkit.ledger``) of a small object, so
there is no delimiter ambiguity and every language derives the same bytes:

* telemetry:       {"kind": "TELEMETRY", "device_id", "reading_ts"}
* business event:  {"kind": "BUSINESS_EVENT", "source_system", "entity_type",
                    "external_id", "version": event_ts}

Timestamps are normalized to ``YYYY-MM-DDTHH:MM:SS.ffffffZ`` (UTC) first, so
``2026-10-06T07:55:00Z`` and ``2026-10-06T13:25:00+05:30`` give the same key.
Language-neutral vectors live in ``contracts/vectors/idempotency.json``.
"""

from __future__ import annotations

from datetime import datetime

from bbc_toolkit.ledger import canonical_hash, iso_utc


def normalize_ts(text: str) -> str:
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return iso_utc(moment)


def telemetry_key(device_id: str, reading_ts: str) -> str:
    return canonical_hash(
        {"kind": "TELEMETRY", "device_id": device_id, "reading_ts": normalize_ts(reading_ts)}
    )


def business_event_key(
    source_system: str, entity_type: str, external_id: str, event_ts: str
) -> str:
    return canonical_hash(
        {
            "kind": "BUSINESS_EVENT",
            "source_system": source_system,
            "entity_type": entity_type,
            "external_id": external_id,
            "version": normalize_ts(event_ts),
        }
    )
