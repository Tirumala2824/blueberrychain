"""Trips: where each lot is, who holds it and what surrounds it, minute by minute.

A trip is a list of :class:`Segment` per lot - field, pre-cooling, cold store, dock,
reefer, DC cold room, receiving - plus the shipments, the customer order lines and the
faults injected into it. The thermal model (``thermal.py``) turns segments into
temperatures; the world driver (``world_driver.py``) turns the same segments into SAP
records, TMS shipments, custody events and device pairings, so telemetry and business
records always tell one consistent story.

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
    truck_id: str | None = None  # REEFER legs, and docks where the truck stops mid-shipment
    lane_id: str | None = None  # REEFER only
    shipment_id: str | None = None  # REEFER legs and mid-shipment stops
    ambient_c: float = 20.0

    def __post_init__(self) -> None:
        if self.kind not in SEGMENT_KINDS:
            raise ValueError(f"unknown segment kind {self.kind}")
        if self.end <= self.start:
            raise ValueError(f"{self.kind} segment must end after it starts")
        if self.kind == "REEFER" and not (self.truck_id and self.lane_id and self.shipment_id):
            raise ValueError("REEFER segments need a truck, a lane and a shipment")


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
    packhouse_site_id: str | None = None

    def segment_at(self, moment: datetime) -> Segment | None:
        for seg in self.segments:
            if seg.start <= moment < seg.end:
                return seg
        return None

    @property
    def end(self) -> datetime:
        return self.segments[-1].end

    @property
    def packed_at(self) -> datetime:
        """End of pre-cooling: when the lot exists as a packed, labelled batch."""
        return next(s.end for s in self.segments if s.kind == "PRECOOL")


@dataclass(frozen=True)
class ShipmentPlan:
    shipment_id: str
    truck_id: str
    carrier_party_id: str
    origin_site_id: str
    destination_site_id: str
    lots: tuple[tuple[str, float], ...]  # (lot_id, kg)
    legs: tuple[Segment, ...]  # REEFER legs and stops, in order
    bol_setpoint_c: float

    @property
    def departure(self) -> datetime:
        return self.legs[0].start

    @property
    def arrival(self) -> datetime:
        return self.legs[-1].end


@dataclass(frozen=True)
class OrderPlan:
    """One customer sales-order line, as the customer placed it."""

    sales_order: str
    item: str
    customer_party_id: str
    ship_to_site_id: str
    product_id: str
    kg: float
    price_usd_per_kg: float
    lot_id: str | None
    shipment_id: str | None
    created_at: datetime
    requested_delivery_at: datetime


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
    lots: tuple[LotPlan, ...]  # the scenario's lot first, then DC inventory
    trucks: dict[str, str]  # truck_id -> reefer device_id
    faults: tuple[Fault, ...] = ()
    shipments: tuple[ShipmentPlan, ...] = ()
    orders: tuple[OrderPlan, ...] = ()

    def faults_for(self, target: str, kind: str | None = None) -> list[Fault]:
        return [f for f in self.faults if f.target == target and (kind is None or f.kind == kind)]

    def lot(self, lot_id: str) -> LotPlan:
        return next(lot for lot in self.lots if lot.lot_id == lot_id)


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

    def until(self, kind: str, end: datetime, holder: str, **kw: Any) -> TripBuilder:
        hours = (end - self.cursor).total_seconds() / 3600
        return self.add(kind, hours, holder, **kw)


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


def _contract_price(world: dict[str, Any], customer: str) -> float:
    return next(
        c["terms"]["price_usd_per_kg"]
        for c in world["contracts"]
        if c["party_id"] == customer and c["contract_type"] == "CUSTOMER_SALES"
    )


def _shipments(world: dict[str, Any], lots: tuple[LotPlan, ...]) -> tuple[ShipmentPlan, ...]:
    trucks = {t["truck_id"]: t for t in world["fleet_sensors"]["trucks"]}
    lanes = _by_id(world["lanes"], "lane_id")
    # Every lot on a shipment carries its own copy of the legs; take them from the first.
    legs: dict[str, list[Segment]] = {}
    loads: dict[str, dict[str, float]] = {}
    for lot in lots:
        mine = [s for s in lot.segments if s.shipment_id]
        for shipment_id in {s.shipment_id for s in mine}:
            assert shipment_id is not None
            loads.setdefault(shipment_id, {})[lot.lot_id] = lot.kg
            legs.setdefault(shipment_id, [s for s in mine if s.shipment_id == shipment_id])
    plans = []
    for shipment_id, segs in legs.items():
        segs.sort(key=lambda s: s.start)
        reefer = [s for s in segs if s.kind == "REEFER"]
        truck = trucks[reefer[0].truck_id]
        plans.append(
            ShipmentPlan(
                shipment_id=shipment_id,
                truck_id=truck["truck_id"],
                carrier_party_id=truck["carrier_party_id"],
                origin_site_id=lanes[reefer[0].lane_id]["origin_site_id"],
                destination_site_id=lanes[reefer[-1].lane_id]["dest_site_id"],
                lots=tuple(sorted(loads[shipment_id].items())),
                legs=tuple(segs),
                bol_setpoint_c=world["thermal"]["room_setpoint_c"],
            )
        )
    return tuple(sorted(plans, key=lambda p: p.departure))


def _dc_inventory(world: dict[str, Any], depart_at: datetime, end: datetime) -> tuple[LotPlan, ...]:
    """Replacement stock already cooling in the Central Valley DC when the scenario starts."""
    lanes = _by_id(world["lanes"], "lane_id")
    # L-R1: organic Emerald from the same grower, moved to the DC the day before.
    r1_harvest = depart_at - timedelta(hours=48)
    r1 = (
        TripBuilder(r1_harvest)
        .add("FIELD", 1.0, "PARTY-EMERALD-RIDGE", site_id="SITE-RANCH14-B7", ambient_c=18.0)
        .add("PRECOOL", 1.5, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK")
        .add("COLD_STORE", 12.0, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK")
        .add("DOCK", 0.5, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK", ambient_c=8.0)
        .add(
            "REEFER",
            lanes["LANE-PACK-CVDC"]["transit_h_p50"],
            "PARTY-SIERRA",
            truck_id="TR-121",
            lane_id="LANE-PACK-CVDC",
            shipment_id="SHP-R1",
            ambient_c=22.0,
        )
    )
    r1.until("DC_COLD", end, "PARTY-BHM", site_id="SITE-CVDC-TRACY")
    # L-R2: organic Duke from Valley Crest, cooled on the farm and trucked in directly.
    r2_harvest = depart_at - timedelta(hours=36)
    r2 = (
        TripBuilder(r2_harvest)
        .add("FIELD", 1.0, "PARTY-VALLEY-CREST", site_id="SITE-VALLEYCREST-B2", ambient_c=20.0)
        .add("PRECOOL", 1.5, "PARTY-VALLEY-CREST", site_id="SITE-VALLEYCREST-B2")
        .add("DOCK", 0.5, "PARTY-VALLEY-CREST", site_id="SITE-VALLEYCREST-B2", ambient_c=8.0)
        .add(
            "REEFER",
            lanes["LANE-VCREST-CVDC"]["transit_h_p50"],
            "PARTY-COASTLINE",
            truck_id="TR-211",
            lane_id="LANE-VCREST-CVDC",
            shipment_id="SHP-R2",
            ambient_c=22.0,
        )
    )
    r2.until("DC_COLD", end, "PARTY-BHM", site_id="SITE-CVDC-TRACY")
    return (
        LotPlan(
            "L-R1",
            "BB-EMERALD-ORG-12x6",
            4200,
            "PARTY-EMERALD-RIDGE",
            "SITE-RANCH14-B7",
            r1_harvest,
            "P-001",
            tuple(r1.segments),
            "SITE-EMERALD-PACK",
        ),
        LotPlan(
            "L-R2",
            "BB-DUKE-ORG-12x6",
            3000,
            "PARTY-VALLEY-CREST",
            "SITE-VALLEYCREST-B2",
            r2_harvest,
            "P-002",
            tuple(r2.segments),
            None,
        ),
    )


def _assemble(world, scenario, lot, faults, order_ids, depart_at) -> Trip:
    inventory = _dc_inventory(world, depart_at, lot.end)
    lots = (lot, *inventory)
    shipments = _shipments(world, lots)
    trucks_by_id = {t["truck_id"]: t["reefer_device_id"] for t in world["fleet_sensors"]["trucks"]}
    main = next(s for s in shipments if (lot.lot_id, lot.kg) in s.lots)
    customer = "PARTY-SUMMIT"
    order = OrderPlan(
        sales_order=order_ids[0],
        item="10",
        customer_party_id=customer,
        ship_to_site_id=main.destination_site_id,
        product_id=lot.product_id,
        kg=lot.kg,
        price_usd_per_kg=_contract_price(world, customer),
        lot_id=lot.lot_id,
        shipment_id=main.shipment_id,
        created_at=depart_at - timedelta(hours=30),
        requested_delivery_at=main.arrival.replace(hour=0, minute=0, second=0, microsecond=0)
        + timedelta(days=1),
    )
    return Trip(
        scenario=scenario,
        start=min(x.harvest_at for x in lots),
        end=lot.end,
        lots=lots,
        trucks={s.truck_id: trucks_by_id[s.truck_id] for s in shipments},
        faults=faults,
        shipments=shipments,
        orders=(order,),
    )


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
    if scenario == "S-A":
        return _scenario_a(world, depart_at, lanes, overrides, cold_store_days)
    if scenario == "S-B":
        return _scenario_b(world, depart_at, lanes, overrides, cold_store_days)
    raise ValueError(f"unknown scenario {scenario}; known: S-A, S-B")


def _scenario_a(world, depart_at, lanes, overrides, cold_store_days) -> Trip:
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
            shipment_id="SHP-A",
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
        "SITE-EMERALD-PACK",
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
    return _assemble(world, "S-A", lot, (fault,), ("6001",), depart_at)


def _scenario_b(world, depart_at, lanes, overrides, cold_store_days) -> Trip:
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
    b.add("DOCK", 0.5, "PARTY-EMERALD-RIDGE", site_id="SITE-EMERALD-PACK", ambient_c=8.0)
    b.add(
        "REEFER",
        first_h,
        "PARTY-COASTLINE",
        truck_id="TR-207",
        lane_id="LANE-PACK-CVDC",
        shipment_id="SHP-B",
        ambient_c=22.0,
    )
    # Cross-dock stop: the truck's doors stand open at the DC dock.
    b.add(
        "DOCK",
        dwell["minutes"] / 60,
        "PARTY-BHM",
        site_id=dwell["site_id"],
        truck_id="TR-207",
        shipment_id="SHP-B",
        ambient_c=dwell["ambient_c"],
    )
    b.add(
        "REEFER",
        second_h,
        "PARTY-COASTLINE",
        truck_id="TR-207",
        lane_id="LANE-CVDC-SLC",
        shipment_id="SHP-B",
        ambient_c=20.0,
    )
    b.add("RECEIVING", 0.5, "PARTY-SUMMIT", site_id="SITE-SUMMIT-SLC", ambient_c=4.0)
    lot = LotPlan(
        "L-B",
        "BB-DUKE-ORG-12x6",
        3600,
        "PARTY-EMERALD-RIDGE",
        "SITE-RANCH14-B7",
        harvest_at,
        "P-B1",
        tuple(b.segments),
        "SITE-EMERALD-PACK",
    )
    faults = (
        Fault("precool_delay", "L-B", params=delay),
        Fault("door_open_dwell", "SHP-B", params=dwell),
        Fault("paperwork_inconsistent", "L-B", params=paper),
    )
    return _assemble(world, "S-B", lot, faults, ("6002",), depart_at)


def with_end(trip: Trip, end: datetime) -> Trip:
    """Cut a trip short (e.g. simulate only the first 10 minutes of the haul)."""
    return replace(trip, end=min(end, trip.end))
