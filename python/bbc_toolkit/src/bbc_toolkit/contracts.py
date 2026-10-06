"""Decision-contract schemas: loading and validation (JSON Schema 2020-12).

The canonical schemas live in the repo's ``contracts/schemas``. Inside a
Snowflake procedure they ship bundled in the package zip (``_contracts/``)
and are read through ``importlib.resources``, which works for zip imports.
``BBC_CONTRACTS_DIR`` overrides both.

Works with jsonschema >= 4.18 (``referencing`` registry) and falls back to the
legacy ``RefResolver`` store on older 4.x releases.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import cache
from importlib import resources
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


@dataclass(frozen=True)
class ContractError:
    path: str  # JSON Pointer into the instance
    message: str
    keyword: str


def contracts_dir() -> Traversable:
    override = os.environ.get("BBC_CONTRACTS_DIR")
    if override:
        return Path(override)
    bundled = resources.files("bbc_toolkit").joinpath("_contracts")
    if bundled.joinpath("schemas").joinpath("common.json").is_file():
        return bundled
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "contracts"
        if (candidate / "schemas" / "common.json").is_file():
            return candidate
    raise FileNotFoundError("contracts/schemas not found; set BBC_CONTRACTS_DIR")


def _walk_json(root: Traversable, prefix: str = "") -> list[tuple[str, Traversable]]:
    found: list[tuple[str, Traversable]] = []
    for entry in sorted(root.iterdir(), key=lambda e: e.name):
        rel = f"{prefix}{entry.name}"
        if entry.is_dir():
            found.extend(_walk_json(entry, rel + "/"))
        elif entry.name.endswith(".json"):
            found.append((rel, entry))
    return found


@cache
def _documents() -> dict[str, dict[str, Any]]:
    schemas = contracts_dir().joinpath("schemas")
    return {rel: json.loads(f.read_text(encoding="utf-8")) for rel, f in _walk_json(schemas)}


def schema_names() -> list[str]:
    """Schema names relative to contracts/schemas, e.g. ``tools/get_precedents.json``."""
    return sorted(_documents())


def _build_validator(
    schema: dict[str, Any], documents: dict[str, dict[str, Any]]
) -> Draft202012Validator:
    try:
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012
    except ImportError:  # jsonschema < 4.18: legacy resolver with an $id store
        from jsonschema import RefResolver

        store = {doc["$id"]: doc for doc in documents.values()}
        resolver = RefResolver(base_uri=schema["$id"], referrer=schema, store=store)
        return Draft202012Validator(schema, resolver=resolver, format_checker=FormatChecker())

    registry: Registry = Registry()
    for doc in documents.values():
        registry = registry.with_resource(
            doc["$id"], Resource.from_contents(doc, default_specification=DRAFT202012)
        )
    return Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())


@cache
def validator(name: str) -> Draft202012Validator:
    documents = _documents()
    if name not in documents:
        raise KeyError(f"unknown contract schema: {name}")
    schema = documents[name]
    Draft202012Validator.check_schema(schema)
    return _build_validator(schema, documents)


def validate(name: str, instance: Any) -> list[ContractError]:
    """Return every violation of the named contract (empty list = valid)."""
    errors = sorted(validator(name).iter_errors(instance), key=lambda e: list(e.absolute_path))
    return [
        ContractError(
            path="/" + "/".join(str(p) for p in error.absolute_path),
            message=error.message,
            keyword=str(error.validator),
        )
        for error in errors
    ]
