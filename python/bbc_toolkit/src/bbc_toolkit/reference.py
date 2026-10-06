"""Versioned reference data: entity mapping and change planning (pure Python).

``API.APPLY_REFERENCE_CHANGE`` validates each record against its contract,
compares its canonical hash with the current version, and writes a new version
only when something changed. Content rows are append-only; only the version
metadata (``is_current``, ``valid_to``) of the superseded row is updated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bbc_toolkit import contracts
from bbc_toolkit.ledger import canonical_hash


@dataclass(frozen=True)
class Entity:
    table: str
    schema: str
    key: tuple[str, ...]


ENTITIES: dict[str, Entity] = {
    "PARTY": Entity("BBC_OS.REF.PARTIES", "reference/party.json", ("party_id",)),
    "SITE": Entity("BBC_OS.REF.SITES", "reference/site.json", ("site_id",)),
    "LANE": Entity("BBC_OS.REF.LANES", "reference/lane.json", ("lane_id",)),
    "PRODUCT": Entity("BBC_OS.REF.PRODUCTS", "reference/product.json", ("product_id",)),
    "CUSTOMER_SPEC": Entity(
        "BBC_OS.REF.CUSTOMER_SPECS",
        "reference/customer_spec.json",
        ("customer_party_id", "product_id"),
    ),
    "CONTRACT": Entity("BBC_OS.REF.CONTRACTS", "reference/contract.json", ("contract_id",)),
    "CHANNEL_PRICE": Entity(
        "BBC_OS.REF.CHANNEL_PRICES",
        "reference/channel_price.json",
        ("product_id", "channel", "effective_from"),
    ),
    "SENSOR": Entity("BBC_OS.REF.SENSORS", "reference/sensor.json", ("device_id",)),
    "COST_RATE": Entity("BBC_OS.REF.COST_RATES", "reference/cost_rate.json", ("cost_rate_id",)),
}
META_COLUMNS = (
    "version",
    "valid_from",
    "valid_to",
    "is_current",
    "changed_by",
    "change_reason",
    "record_hash",
    "batch_id",
)


def entity(entity_type: str) -> Entity:
    try:
        return ENTITIES[entity_type]
    except KeyError:
        raise KeyError(f"unknown reference entity: {entity_type}") from None


def columns(entity_type: str) -> list[str]:
    """Content columns, in schema order (the REF table's leading columns)."""
    props = contracts.validator(entity(entity_type).schema).schema["properties"]
    return list(props)


def json_columns(entity_type: str) -> set[str]:
    """Columns stored as VARIANT (objects / arrays in the contract)."""
    props = contracts.validator(entity(entity_type).schema).schema["properties"]
    return {name for name, spec in props.items() if spec.get("type") in ("object", "array")}


def key_of(entity_type: str, record: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(record[k] for k in entity(entity_type).key)


def validate_batch(entity_type: str, records: list[dict[str, Any]]) -> list[str]:
    ent = entity(entity_type)
    problems = []
    for i, record in enumerate(records):
        for error in contracts.validate(ent.schema, record):
            problems.append(f"records[{i}] {error.path}: {error.message}")
    keys = [key_of(entity_type, r) for r in records if all(k in r for k in ent.key)]
    for key in {k for k in keys if keys.count(k) > 1}:
        problems.append(f"duplicate key in batch: {key}")
    return problems


@dataclass(frozen=True)
class Change:
    key: tuple[Any, ...]
    record: dict[str, Any]
    record_hash: str
    previous_version: int | None  # None = new key


def plan_changes(
    entity_type: str,
    records: list[dict[str, Any]],
    current: dict[tuple[Any, ...], tuple[int, str]],
) -> tuple[list[Change], int]:
    """Which records need a new version. ``current`` maps key -> (version, record_hash)."""
    changes, unchanged = [], 0
    for record in records:
        key = key_of(entity_type, record)
        digest = canonical_hash(record)
        existing = current.get(key)
        if existing and existing[1] == digest:
            unchanged += 1
            continue
        changes.append(Change(key, record, digest, existing[0] if existing else None))
    return changes, unchanged


def insert_sql(entity_type: str) -> tuple[str, list[str]]:
    """INSERT ... SELECT with one bind per content column (VARIANT columns via PARSE_JSON)."""
    ent, cols, js = entity(entity_type), columns(entity_type), json_columns(entity_type)
    exprs = ["PARSE_JSON(?)" if c in js else "?" for c in cols]
    meta_exprs = ["?", "CURRENT_TIMESTAMP()", "NULL", "TRUE", "CURRENT_USER()", "?", "?", "?"]
    sql = (
        f"INSERT INTO {ent.table} ({', '.join(cols + list(META_COLUMNS))}) "
        f"SELECT {', '.join(exprs + meta_exprs)}"
    )
    return sql, cols


def key_predicate(entity_type: str) -> str:
    return " AND ".join(f"{k} = ?" for k in entity(entity_type).key)
