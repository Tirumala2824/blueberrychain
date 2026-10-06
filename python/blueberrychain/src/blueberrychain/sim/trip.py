"""Trips: where each lot is, who holds it and what surrounds it, minute by minute.

A trip is a list of :class:`Segment` per lot - field, pre-cooling, cold store, dock,
reefer, DC cold room, receiving - plus the trucks and the faults injected into it.
The thermal model (``thermal.py``) turns segments into temperatures; Day 4 turns the
same segments into custody events, shipments and device assignments for the mock
systems, so telemetry and business records always tell one consistent story.

Scenario builders (``scenario_trip``) fix the world state and the fault - never the
outcome (docs/demo/scenarios.md).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any

SEGMENT_KINDS = ("FIELD", "PRECOOL", "COLD_STORE", "DOCK", "REEFER", "DC_COLD", "RECEIVING")


@dataclass(frozen=True)
class Segment:
    kind: str
    start: datetime
    end: datetime
    holder_party_id: str
    site_id: str | None = None  # None while in transit
    truck_id: str | None = None  # REEFER only
    lane_id: str | None = None  # REEFER only
    ambient_c: float = 20.0

    def __post_init__(self) -> None:
        if self.kind not in SEGMENT_KINDS:
            raise ValueError(f"unknown segment kind {self.kind}")
        if self.end <= self.start:
            raise ValueError(f"{self.kind} segment must end after it starts")
        if self.kind == "REEFER" and not (self.truck_id and self.lane_id):
            raise ValueError("REEFER segments need a truck and a lane")


@dataclass(frozen=True)
class LotPlan:
    lot_id: str
    product_id: str
    kg: float
    grower_party_id: str
    harvest_site_id: str
    harvest_at: datetime
    probe_device_id: str
    segments: tuple[Segment, ...]

    def segment_at(self, moment: datetime) -> Segment | None:
        for seg in self.segments:
            if seg.start <= moment < seg.end:
                return seg
        return None

    @property
    def end(self) -> datetime:
        return self.segments[-1].end


@dataclass(frozen=True)
class Fault:
    """One injected fault (world.yaml ``faults`` catalog), resolved to absolute times."""

    kind: str
    target: str  # truck_id, lot_id or shipment/site depending on the kind
    start: datetime | None = None
    end: datetime | None = None
    params: dict[str, Any] = field(default_factory=dict)

    def active(self, moment: datetime) -> bool:
        if self.start is None:
            return True  # whole-trip faults (setpoint error, probe misplaced)
        return self.start <= moment < (self.end or datetime.max.replace(tzinfo=moment.tzinfo))


@dataclass(frozen=True)
class Trip:
    scenario: str
    start: datetime
    end: datetime
    lots: tuple[LotPlan, ...]
    trucks: dict[str, str]  # truck_id -> reefer device_id
    faults: tuple[Fault, ...] = ()

    def faults_for(self, target: str, kind: str | None = None) -> list[Fault]:
        return [f for f in self.faults if f.target == target and (kind is None or f.kind == kind)]


class TripBuilder:
    """Appends consecutive segments to a lot's itinerary."""

    def __init__(self, start: datetime):
        self.cursor = start
        self.segments: list[Segment] = []

    def add(self, kind: str, hours: float, holder: str, **kw: Any) -> TripBuilder:
        end = self.cursor + timedelta(hours=hours)
        self.segments.append(Segment(kind, self.cursor, end, holder, **kw))
        self.cursor = end
        return self


def _by_id(rows: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    return {r[key]: r for r in rows}


def _fault(
    world: dict[str, Any], kind: str, target: str, overrides: dict[str, Any]
) -> dict[str, Any]:
    catalog = world["faults"]
    if kind not in catalog:
        raise ValueError(f"unknown fault {kind}; known: {sorted(catalog)}")
    unknown = set(overrides) - set(catalog[kind]["defaults"])
    if unknown:
        raise ValueError(f"{kind} has no parameter(s) {sorted(unknown)}")
    return {**catalog[kind]["defaults"], **overrides}


def scenario_trip(
    world: dict[str, Any],
    scenario: str,
    depart_at: datetime,
    fault_overrides: dict[str, dict[str, Any]] | None = None,
    cold_store_days: float | None = None,
) -> Trip:
    """The trips behind docs/demo/scenarios.md, anchored on the truck's departure time."""
    overrides = fault_overrides or {}
    lanes = _by_id(world["lanes"], "lane_id")
    trucks = {t["truck_id"]: t["reefer_device_id"] for t in world["fleet_sensors"]["trucks"]}
    if scenario == "S-A":
        return _scenario_a(world, depart_at, lanes, trucks, overrides, cold_store_days)
    if scenario == "S-B":
        return _scenario_b(world, depart_at, lanes, trucks, overrides, cold_store_days)
    raise ValueError(f"unknown scenario {scenario}; known: S-A, S-B")


def _scenario_a(world, depart_at, lanes, trucks, overrides, cold_store_days) -> Trip:
    # Lot L-A: organic Emerald, packed and held in the packhouse cooler before the long haul
    # to the Summit Club DC, where a reefer compressor fails early in the trip.
    days = 5.0 if cold_store_days is None else cold_store_days
    haul_h = lanes["LANE-PACK-SLC"]["transit_h_p50"]
    harvest_at = depart_at - timedelta(hours=1.0 + 1.5 + days * 24 + 0.5)
    b = (
        TripBuilder(harvest_at)
        .add("FIELD", 1.0, "PARTY-EMERALD-RIDGE", site_id="SITE-RANCH14-B7", ambient_c=19.0)
        .add("PRECOOL", 1.5, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK")
        .add("COLD_STORE", days * 24, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK")
        .add("DOCK", 0.5, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK", ambient_c=8.0)
        .add(
            "REEFER",
            haul_h,
            "PARTY-SIERRA",
            truck_id="TR-114",
            lane_id="LANE-PACK-SLC",
            ambient_c=24.0,
        )
        .add("RECEIVING", 0.5, "PARTY-SUMMIT", site_id="SITE-SUMMIT-SLC", ambient_c=4.0)
    )
    lot = LotPlan(
        "L-A",
        "BB-EMERALD-ORG-12x6",
        4200,
        "PARTY-EMERALD-RIDGE",
        "SITE-RANCH14-B7",
        harvest_at,
        "P-A1",
        tuple(b.segments),
    )
    p = _fault(
        world,
        "reefer_compressor_failure",
        "TR-114",
        {"start_after_h": 0.5, **overrides.get("reefer_compressor_failure", {})},
    )
    start = depart_at + timedelta(hours=p["start_after_h"])
    fault = Fault(
        "reefer_compressor_failure", "TR-114", start, start + timedelta(hours=p["duration_h"]), p
    )
    return Trip("S-A", harvest_at, lot.end, (lot,), {"TR-114": trucks["TR-114"]}, (fault,))


def _scenario_b(world, depart_at, lanes, trucks, overrides, cold_store_days) -> Trip:
    # Lot L-B: organic Duke picked on a hot afternoon, pre-cooled late and in a rush, so
    # it loads warm; via the Central Valley DC cross-dock (doors left open) to Summit.
    days = 0.0 if cold_store_days is None else cold_store_days
    delay = _fault(world, "precool_delay", "L-B", overrides.get("precool_delay", {}))
    dwell = _fault(world, "door_open_dwell", "SHP-B", overrides.get("door_open_dwell", {}))
    paper = _fault(
        world, "paperwork_inconsistent", "L-B", overrides.get("paperwork_inconsistent", {})
    )
    first_h = lanes["LANE-PACK-CVDC"]["transit_h_p50"]
    second_h = lanes["LANE-CVDC-SLC"]["transit_h_p50"]
    harvest_at = depart_at - timedelta(hours=1.0 + delay["hours"] + 1.0 + days * 24 + 0.5)
    b = (
        TripBuilder(harvest_at)
        .add(
            "FIELD",
            1.0 + delay["hours"],
            "PARTY-EMERALD-RIDGE",
            site_id="SITE-RANCH14-B7",
            ambient_c=30.0,
        )
        # A rushed pre-cool after the delay: one hour instead of a full cycle.
        .add("PRECOOL", 1.0, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK")
    )
    if days > 0:
        b.add("COLD_STORE", days * 24, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK")
    (
        b.add("DOCK", 0.5, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK", ambient_c=8.0)
        .add(
            "REEFER",
            first_h,
            "PARTY-COASTLINE",
            truck_id="TR-207",
            lane_id="LANE-PACK-CVDC",
            ambient_c=22.0,
        )
        .add(
            "DOCK",
            dwell["minutes"] / 60,
            "PARTY-BHM",
            site_id=dwell["site_id"],
            ambient_c=dwell["ambient_c"],
        )
        .add(
            "REEFER",
            second_h,
            "PARTY-COASTLINE",
            truck_id="TR-207",
            lane_id="LANE-CVDC-SLC",
            ambient_c=20.0,
        )
        .add("RECEIVING", 0.5, "PARTY-SUMMIT", site_id="SITE-SUMMIT-SLC", ambient_c=4.0)
    )
    lot = LotPlan(
        "L-B",
        "BB-DUKE-ORG-12x6",
        3600,
        "PARTY-EMERALD-RIDGE",
        "SITE-RANCH14-B7",
        harvest_at,
        "P-B1",
        tuple(b.segments),
    )
    faults = (
        Fault("precool_delay", "L-B", params=delay),
        Fault("door_open_dwell", "SHP-B", params=dwell),
        Fault("paperwork_inconsistent", "L-B", params=paper),
    )
    return Trip("S-B", harvest_at, lot.end, (lot,), {"TR-207": trucks["TR-207"]}, faults)


def with_end(trip: Trip, end: datetime) -> Trip:
    """Cut a trip short (e.g. simulate only the first 10 minutes of the haul)."""
    return replace(trip, end=min(end, trip.end))
