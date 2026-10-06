"""World configuration: load, expand, validate, and emit reference batches.

`world.yaml` is the single source of the simulated world's reference data.
`reference_batches()` turns it into the record batches that
``API.APPLY_REFERENCE_CHANGE`` loads, after validating every record against
``contracts/schemas/reference/*.json`` and checking referential integrity.
"""

from __future__ import annotations

import datetime as dt
import json
from collections import Counter
from importlib import resources
from pathlib import Path
from typing import Any

import yaml
from bbc_toolkit import contracts

# world.yaml section -> (reference entity type, contract schema)
SECTIONS: dict[str, tuple[str, str]] = {
    "parties": ("PARTY", "reference/party.json"),
    "sites": ("SITE", "reference/site.json"),
    "lanes": ("LANE", "reference/lane.json"),
    "products": ("PRODUCT", "reference/product.json"),
    "customer_specs": ("CUSTOMER_SPEC", "reference/customer_spec.json"),
    "contracts": ("CONTRACT", "reference/contract.json"),
    "channel_prices": ("CHANNEL_PRICE", "reference/channel_price.json"),
    "sensors": ("SENSOR", "reference/sensor.json"),
    "cost_rates": ("COST_RATE", "reference/cost_rate.json"),
}
CONTRACT_PARTY_TYPES = {
    "CARRIER_TRANSPORT": {"CARRIER"},
    "GROWER_SUPPLY": {"GROWER"},
    "CUSTOMER_SALES": {"CUSTOMER"},
}


class WorldError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("invalid world:\n  " + "\n  ".join(problems))
        self.problems = problems


def _plain(value: Any) -> Any:
    """YAML dates become ISO strings so records are pure JSON."""
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def default_world_path() -> Path:
    return Path(str(resources.files("blueberrychain.sim").joinpath("world.yaml")))


def load_world(path: Path | None = None) -> dict[str, Any]:
    text = (path or default_world_path()).read_text(encoding="utf-8")
    return _plain(yaml.safe_load(text))


def _expand_sensors(world: dict[str, Any]) -> list[dict[str, Any]]:
    sensors = list(world.get("sensors", []))
    known = {s["device_id"] for s in sensors}
    fleet = world.get("fleet_sensors", {})
    pool = fleet.get("probe_pool")
    if pool:
        for i in range(1, pool["count"] + 1):
            device_id = f"{pool['prefix']}{i:03d}"
            if device_id not in known:
                sensors.append(
                    {
                        "device_id": device_id,
                        "device_type": "PULP_PROBE",
                        "owner_party_id": pool["owner_party_id"],
                        "placement": pool["placement"],
                        "calibrated_on": pool["calibrated_on"],
                        "accuracy_c": pool["accuracy_c"],
                    }
                )
                known.add(device_id)
    for truck in fleet.get("trucks", []):
        if truck["reefer_device_id"] not in known:
            sensors.append(
                {
                    "device_id": truck["reefer_device_id"],
                    "device_type": "REEFER_UNIT",
                    "owner_party_id": truck["carrier_party_id"],
                    "placement": "RETURN_AIR",
                    "calibrated_on": None,
                    "accuracy_c": 0.5,
                }
            )
            known.add(truck["reefer_device_id"])
    return sensors


def _integrity_problems(
    batches: dict[str, list[dict[str, Any]]], world: dict[str, Any]
) -> list[str]:
    problems: list[str] = []
    parties = {p["party_id"]: p for p in batches["PARTY"]}
    sites = {s["site_id"]: s for s in batches["SITE"]}
    lanes = {lane["lane_id"]: lane for lane in batches["LANE"]}
    products = {p["product_id"] for p in batches["PRODUCT"]}

    keys = {
        "PARTY": "party_id",
        "SITE": "site_id",
        "LANE": "lane_id",
        "PRODUCT": "product_id",
        "CONTRACT": "contract_id",
        "SENSOR": "device_id",
        "COST_RATE": "cost_rate_id",
    }
    for entity, key in keys.items():
        for value, n in Counter(r[key] for r in batches[entity]).items():
            if n > 1:
                problems.append(f"{entity}: duplicate {key} {value}")
    for value, n in Counter(
        (s["customer_party_id"], s["product_id"]) for s in batches["CUSTOMER_SPEC"]
    ).items():
        if n > 1:
            problems.append(f"CUSTOMER_SPEC: duplicate {value}")

    def need(kind: str, value: str | None, pool: dict | set, where: str) -> None:
        if value is not None and value not in pool:
            problems.append(f"{where}: unknown {kind} {value}")

    for s in batches["SITE"]:
        need("party", s["party_id"], parties, f"SITE {s['site_id']}")
    for lane in batches["LANE"]:
        need("site", lane["origin_site_id"], sites, f"LANE {lane['lane_id']}")
        need("site", lane["dest_site_id"], sites, f"LANE {lane['lane_id']}")
        if lane["transit_h_p90"] < lane["transit_h_p50"]:
            problems.append(f"LANE {lane['lane_id']}: p90 transit below p50")
    for spec in batches["CUSTOMER_SPEC"]:
        need("party", spec["customer_party_id"], parties, "CUSTOMER_SPEC")
        need("product", spec["product_id"], products, "CUSTOMER_SPEC")
        party = parties.get(spec["customer_party_id"])
        if party and party["party_type"] not in {"CUSTOMER", "PROCESSOR"}:
            problems.append(
                f"CUSTOMER_SPEC: {spec['customer_party_id']} is not a customer or processor"
            )
    for c in batches["CONTRACT"]:
        need("party", c["party_id"], parties, f"CONTRACT {c['contract_id']}")
        party = parties.get(c["party_id"])
        if party and party["party_type"] not in CONTRACT_PARTY_TYPES[c["contract_type"]]:
            problems.append(
                f"CONTRACT {c['contract_id']}: {c['contract_type']} with a {party['party_type']}"
            )
    with_sales_contract = {
        c["party_id"] for c in batches["CONTRACT"] if c["contract_type"] == "CUSTOMER_SALES"
    }
    with_specs = {s["customer_party_id"] for s in batches["CUSTOMER_SPEC"]}
    for party_id in sorted(with_sales_contract - with_specs):
        problems.append(f"CUSTOMER {party_id}: sales contract but no receipt specs")
    for price in batches["CHANNEL_PRICE"]:
        need("product", price["product_id"], products, "CHANNEL_PRICE")
    for sensor in batches["SENSOR"]:
        need("party", sensor["owner_party_id"], parties, f"SENSOR {sensor['device_id']}")
    for rate in batches["COST_RATE"]:
        scope = rate["scope_type"]
        if scope == "SITE":
            need("site", rate["scope_id"], sites, f"COST_RATE {rate['cost_rate_id']}")
        elif scope == "LANE":
            need("lane", rate["scope_id"], lanes, f"COST_RATE {rate['cost_rate_id']}")
        elif rate["scope_id"] is not None:
            problems.append(
                f"COST_RATE {rate['cost_rate_id']}: GLOBAL scope must not name a scope_id"
            )
    for truck in world.get("fleet_sensors", {}).get("trucks", []):
        carrier = parties.get(truck["carrier_party_id"])
        if not carrier or carrier["party_type"] != "CARRIER":
            problems.append(
                f"TRUCK {truck['truck_id']}: {truck['carrier_party_id']} is not a carrier"
            )
    return problems


def reference_batches(world: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Validated reference records per entity type, ready for APPLY_REFERENCE_CHANGE."""
    batches: dict[str, list[dict[str, Any]]] = {}
    problems: list[str] = []
    for section, (entity, schema) in SECTIONS.items():
        records = _expand_sensors(world) if section == "sensors" else list(world.get(section, []))
        for i, record in enumerate(records):
            for error in contracts.validate(schema, record):
                problems.append(f"{section}[{i}] {error.path}: {error.message}")
        batches[entity] = records
    problems.extend(_integrity_problems(batches, world))
    if problems:
        raise WorldError(problems)
    return batches


def sap_key_map(world: dict[str, Any]) -> dict[str, dict[str, str]]:
    """SAP key -> our id, for connector-sap-s4 (and the simulator's SAP side, in reverse)."""
    sap = world.get("sap", {})
    return {
        "business_partner": {
            p["sap_business_partner"]: p["party_id"]
            for p in world["parties"]
            if p.get("sap_business_partner")
        },
        "plant": {s["sap_plant"]: s["site_id"] for s in world["sites"] if s.get("sap_plant")},
        "material": {
            p["sap_material"]: p["product_id"] for p in world["products"] if p.get("sap_material")
        },
        "ship_to": dict(sap.get("ship_to", {})),
        "harvest_block": dict(sap.get("harvest_blocks", {})),
        "storage_location": {"default": sap.get("storage_location", "0001")},
    }


def write_key_map(world: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "sap_key_map.json"
    path.write_text(
        json.dumps(sap_key_map(world), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return path


def write_batches(
    batches: dict[str, list[dict[str, Any]]], out_dir: Path, world_version: str
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for entity, records in batches.items():
        path = out_dir / f"{entity.lower()}.json"
        body = {"entity_type": entity, "world_version": world_version, "records": records}
        path.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written
