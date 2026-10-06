"""Canonical JSON, hashing and hash-chain verification for LEDGER.ENTRIES.

This module is the single definition of how ledger entries are hashed. The
Snowflake UDF ``LEDGER.CANONICAL_HASH`` and ``API.VERIFY_LEDGER`` run this exact
code, so a payload hashes identically whether it is computed locally or in
Snowflake.

Canonical JSON rules
--------------------
* objects: keys sorted by code point; no insignificant whitespace
* strings: standard JSON escaping, ASCII-only output (non-ASCII as \\uXXXX)
* numbers: a value with no fractional part is written as an integer
  (``45301``, ``45301.0`` and ``Decimal("45301.00")`` are identical); other
  values use the shortest round-trip decimal form without an exponent
  (``0.1``, ``11.2``); NaN and infinities are rejected
* booleans / null: ``true`` / ``false`` / ``null``

Chain rules
-----------
``payload_hash = sha256(canonical(payload))``. The chained header is
``{seq, ts, entry_type, case_id, actor, record_ref, payload_hash, prev_hash}``
and ``entry_hash = sha256(canonical(header))``. The first entry's prev_hash is
64 zeros. ``ts`` is the ISO-8601 UTC string stored with the entry.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

GENESIS_HASH = "0" * 64
HEADER_FIELDS = (
    "seq",
    "ts",
    "entry_type",
    "case_id",
    "actor",
    "record_ref",
    "payload_hash",
    "prev_hash",
)


def _number(value: int | float | Decimal) -> str:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("NaN and infinity are not allowed in canonical JSON")
    if isinstance(value, Decimal) and not value.is_finite():
        raise ValueError("NaN and infinity are not allowed in canonical JSON")
    decimal = (
        value
        if isinstance(value, Decimal)
        else Decimal(repr(value) if isinstance(value, float) else value)
    )
    if decimal == decimal.to_integral_value():
        return str(int(decimal))
    text = format(decimal.normalize(), "f")
    return text


def canonical_json(value: Any) -> str:
    """Serialize ``value`` to canonical JSON (see module docstring)."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int | float | Decimal):
        return _number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=True)
    if isinstance(value, Mapping):
        items = []
        for key in sorted(value):
            if not isinstance(key, str):
                raise TypeError(f"object keys must be strings, got {type(key).__name__}")
            items.append(json.dumps(key, ensure_ascii=True) + ":" + canonical_json(value[key]))
        return "{" + ",".join(items) + "}"
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    raise TypeError(f"not JSON-serializable: {type(value).__name__}")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_hex(canonical_json(value))


def iso_utc(moment: datetime) -> str:
    """Ledger timestamp format: ``YYYY-MM-DDTHH:MM:SS.ffffffZ`` in UTC."""
    if moment.tzinfo is None:
        raise ValueError("ledger timestamps must be timezone-aware")
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


@dataclass(frozen=True)
class LedgerEntry:
    seq: int
    ts: str
    entry_type: str
    case_id: str | None
    actor: str
    record_ref: str
    payload: Any
    payload_hash: str
    prev_hash: str
    entry_hash: str

    def header(self) -> dict[str, Any]:
        return {field: getattr(self, field) for field in HEADER_FIELDS}


def make_entry(
    *,
    seq: int,
    ts: str,
    entry_type: str,
    case_id: str | None,
    actor: str,
    record_ref: str,
    payload: Any,
    prev_hash: str,
) -> LedgerEntry:
    payload_hash = canonical_hash(payload)
    header = {
        "seq": seq,
        "ts": ts,
        "entry_type": entry_type,
        "case_id": case_id,
        "actor": actor,
        "record_ref": record_ref,
        "payload_hash": payload_hash,
        "prev_hash": prev_hash,
    }
    return LedgerEntry(**header, payload=payload, entry_hash=canonical_hash(header))


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    checked: int
    first_bad_seq: int | None = None
    reason: str | None = None


def verify_chain(
    entries: Iterable[LedgerEntry], start_prev_hash: str = GENESIS_HASH
) -> VerifyResult:
    """Recompute every hash in seq order and report the first break."""
    prev_hash = start_prev_hash
    expected_seq: int | None = None
    checked = 0
    for entry in sorted(entries, key=lambda e: e.seq):
        if expected_seq is not None and entry.seq != expected_seq:
            return VerifyResult(False, checked, expected_seq, "SEQ_GAP")
        if canonical_hash(entry.payload) != entry.payload_hash:
            return VerifyResult(False, checked, entry.seq, "PAYLOAD_HASH_MISMATCH")
        if entry.prev_hash != prev_hash:
            return VerifyResult(False, checked, entry.seq, "PREV_HASH_BREAK")
        if canonical_hash(entry.header()) != entry.entry_hash:
            return VerifyResult(False, checked, entry.seq, "ENTRY_HASH_MISMATCH")
        prev_hash = entry.entry_hash
        expected_seq = entry.seq + 1
        checked += 1
    return VerifyResult(True, checked)
