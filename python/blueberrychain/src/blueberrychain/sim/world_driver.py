"""Drive every system of the simulated world from one trip (ADR-0006: front doors only).

``world_actions`` turns a trip into what each system would record, at the moment it
would record it:

* **SAP S/4** (mock-s4 ``/__sim``): batch master at packing, the origin inspection at
  loading, stock by plant and stock type, the customer's sales order, the outbound
  delivery, goods issue and proof of delivery;
* **TMS** (mock-tms ``/__sim``): the shipment plan, status events (loading, departure,
  positions every 30 minutes, the junction passing, arrival) and custody handoffs
  that match the trip's segment holders exactly;
* **IoT platform** (connector-iot ``/v1/pairings``, signed): probe -> lot at harvest,
  reefer unit -> shipment from departure to arrival.

``run_world`` replays the actions and the telemetry messages in time order - setting
the mocks' clocks to simulated time first - so connectors see a world that unfolds.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from base64 import b64encode
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from itertools import groupby
from typing import Any

from blueberrychain.sim import telemetry as tm
from blueberrychain.sim.clock import SimClock, iso, utc
from blueberrychain.sim.trip import LotPlan, Segment, ShipmentPlan, Trip

POSITION_EVERY = timedelta(minutes=30)


@dataclass(frozen=True)
class Action:
    at: datetime
    system: str  # S4 | TMS | IOT
    method: str
    path: str
    body: dict[str, Any]
    label: str


class _Keys:
    """Our ids -> SAP keys (the reverse of connector-sap-s4's key map)."""

    def __init__(self, world: dict[str, Any]):
        self.partner = {
            p["party_id"]: p["sap_business_partner"]
            for p in world["parties"]
            if p.get("sap_business_partner")
        }
        self.plant = {s["site_id"]: s["sap_plant"] for s in world["sites"] if s.get("sap_plant")}
        self.material = {p["product_id"]: p["sap_material"] for p in world["products"]}
        self.organic = {p["product_id"]: p["organic"] for p in world["products"]}
        self.ship_to = {site: key for key, site in world["sap"]["ship_to"].items()}
        self.block = {site: key for key, site in world["sap"]["harvest_blocks"].items()}
        self.sloc = world["sap"]["storage_location"]


def _number(prefix: str, key: str, digits: int) -> str:
    """A stable document number (Python's hash() is randomized per process)."""
    return prefix + str(int(hashlib.sha256(key.encode()).hexdigest(), 16) % 10**digits).zfill(
        digits
    )


def _probe_reading(messages: list[dict[str, Any]], device: str, at: datetime) -> float | None:
    stamp = iso(at)
    readings = [m for m in messages if m["device_id"] == device and m["ts"] <= stamp]
    return readings[-1]["values"]["pulp_c"] if readings else None


def _junction(world: dict[str, Any], lane_id: str) -> tuple[str, float] | None:
    """A JUNCTION site on the lane's route, and the hours from the origin to it."""
    lanes = {(lane["origin_site_id"], lane["dest_site_id"]): lane for lane in world["lanes"]}
    lane = next(lane for lane in world["lanes"] if lane["lane_id"] == lane_id)
    for site in world["sites"]:
        if site["site_type"] != "JUNCTION":
            continue
        first = lanes.get((lane["origin_site_id"], site["site_id"]))
        if first and (site["site_id"], lane["dest_site_id"]) in lanes:
            return site["site_id"], first["transit_h_p50"]
    return None


def _position(world: dict[str, Any], seg: Segment, at: datetime) -> tuple[float, float]:
    coords = {s["site_id"]: (s["lat"], s["lon"]) for s in world["sites"]}
    lane = next(lane for lane in world["lanes"] if lane["lane_id"] == seg.lane_id)
    (a_lat, a_lon), (b_lat, b_lon) = coords[lane["origin_site_id"]], coords[lane["dest_site_id"]]
    f = (at - seg.start) / (seg.end - seg.start)
    return round(a_lat + (b_lat - a_lat) * f, 4), round(a_lon + (b_lon - a_lon) * f, 4)


def _holder_after(trip: Trip, shipment: ShipmentPlan, moment: datetime) -> str:
    lot = trip.lot(shipment.lots[0][0])
    seg = lot.segment_at(moment)
    return seg.holder_party_id if seg else lot.segments[-1].holder_party_id


def world_actions(
    world: dict[str, Any], trip: Trip, messages: list[dict[str, Any]]
) -> list[Action]:
    keys = _Keys(world)
    acts: list[Action] = []

    def s4(at: datetime, path: str, body: dict[str, Any], label: str) -> None:
        acts.append(
            Action(at, "S4", "PUT" if path == "/__sim/stock" else "POST", path, body, label)
        )

    def tms(at: datetime, path: str, body: dict[str, Any], label: str) -> None:
        acts.append(Action(at, "TMS", "POST", path, body, label))

    def iot(at: datetime, body: dict[str, Any], label: str) -> None:
        acts.append(Action(at, "IOT", "POST", "/v1/pairings", body, label))

    def event(sid: str, at: datetime, suffix: str, **fields: Any) -> None:
        record = {"event_id": f"{sid}-{suffix}", "shipment_id": sid, "at": iso(at), **fields}
        tms(at, "/__sim/events", {"records": [record]}, f"{sid} {suffix}")

    paper = {f.target: f.params for f in trip.faults if f.kind == "paperwork_inconsistent"}

    def stock(at: datetime, plant: str, lot: LotPlan, stock_type: str, qty: float, label: str):
        s4(
            at,
            "/__sim/stock",
            {
                "records": [
                    {
                        "Material": keys.material[lot.product_id],
                        "Plant": plant,
                        "StorageLocation": keys.sloc,
                        "Batch": lot.lot_id,
                        "InventoryStockType": stock_type,
                        "quantity": qty,
                    }
                ]
            },
            label,
        )

    # ---- lots: probe pairing at harvest, batch master and stock at packing, origin QC at loading
    for lot in trip.lots:
        iot(
            lot.harvest_at,
            {
                "source": "bbc-sim",
                "pairings": [
                    {
                        "pairing_id": f"PAIR-{lot.probe_device_id}-{lot.lot_id}",
                        "device_id": lot.probe_device_id,
                        "target_type": "LOT",
                        "target_id": lot.lot_id,
                        "role": "PRIMARY",
                        "assigned_from": iso(lot.harvest_at),
                        "changed_at": iso(lot.harvest_at),
                        "provenance": tm.PROVENANCE,
                    }
                ],
            },
            f"pair {lot.probe_device_id} -> {lot.lot_id}",
        )
        receiving = next(s for s in lot.segments if s.kind in ("DC_COLD", "RECEIVING"))
        plant = keys.plant.get(lot.packhouse_site_id or "") or keys.plant.get(
            receiving.site_id or ""
        )
        s4(
            lot.packed_at,
            "/__sim/batches",
            {
                "records": [
                    {
                        "Material": keys.material[lot.product_id],
                        "BatchIdentifyingPlant": plant,
                        "Batch": lot.lot_id,
                        "Supplier": keys.partner[lot.grower_party_id],
                        "YY1_HarvestBlock": keys.block[lot.harvest_site_id],
                        "ManufactureDate": iso(lot.harvest_at),
                        "YY1_HarvestDateTime": iso(lot.harvest_at),
                        "YY1_PackedDateTime": iso(lot.packed_at),
                        "YY1_NetWeightKg": lot.kg,
                        "YY1_Organic": "X" if keys.organic[lot.product_id] else "",
                    }
                ]
            },
            f"batch {lot.lot_id}",
        )
        if lot.packhouse_site_id in keys.plant:
            stock(
                lot.packed_at,
                keys.plant[lot.packhouse_site_id],
                lot,
                "01",
                lot.kg,
                f"stock {lot.lot_id} packed",
            )
        loading = next((s for s in lot.segments if s.kind == "DOCK" and not s.shipment_id), None)
        if loading and lot.packhouse_site_id in keys.plant:
            measured = _probe_reading(messages, lot.probe_device_id, loading.start)
            claimed = paper.get(lot.lot_id, {}).get("claimed_value")
            s4(
                loading.start,
                "/__sim/inspection-lots",
                {
                    "records": [
                        {
                            "InspectionLot": _number("89", lot.lot_id, 7),
                            "Material": keys.material[lot.product_id],
                            "Batch": lot.lot_id,
                            "Plant": keys.plant[lot.packhouse_site_id],
                            "InspectionLotType": "89",
                            "InspLotCreatedOnLocalDate": iso(loading.start),
                            "YY1_InspectedAt": iso(loading.start),
                            "InspectionLotUsageDecisionCode": "A",
                            # The packhouse's own record: with bad paperwork, the claimed value.
                            "YY1_PulpTempC": claimed if claimed is not None else measured,
                            "YY1_InspectorName": "Packhouse QC",
                        }
                    ]
                },
                f"origin QC {lot.lot_id}",
            )

    # ---- customer order lines
    for order in trip.orders:
        s4(
            order.created_at,
            "/__sim/sales-orders",
            {
                "records": [
                    {
                        "SalesOrder": order.sales_order,
                        "SoldToParty": keys.partner[order.customer_party_id],
                        "SalesOrderDate": iso(order.created_at),
                        "PurchaseOrderByCustomer": f"PO-{order.sales_order}",
                        "items": [
                            {
                                "SalesOrderItem": order.item,
                                "Material": keys.material[order.product_id],
                                "RequestedQuantity": order.kg,
                                "RequestedQuantityUnit": "KG",
                                "NetPriceAmount": order.price_usd_per_kg,
                                "NetPriceQuantity": 1,
                                "Batch": order.lot_id or "",
                                "ShipToParty": keys.ship_to[order.ship_to_site_id],
                                "RequestedDeliveryDate": iso(order.requested_delivery_at),
                                "SDProcessStatus": "A",
                            }
                        ],
                    }
                ]
            },
            f"order {order.sales_order}/{order.item}",
        )

    # ---- shipments
    for shipment in trip.shipments:
        sid = shipment.shipment_id
        depart, arrive = shipment.departure, shipment.arrival
        first_leg = shipment.legs[0]
        tms(
            depart - timedelta(hours=6),
            "/__sim/shipments",
            {
                "records": [
                    {
                        "shipment_id": sid,
                        "carrier_party_id": shipment.carrier_party_id,
                        "origin_site_id": shipment.origin_site_id,
                        "destination_site_id": shipment.destination_site_id,
                        "planned_departure_at": iso(depart),
                        "planned_arrival_at": iso(arrive),
                        "reefer_device_id": trip.trucks[shipment.truck_id],
                        "truck_id": shipment.truck_id,
                        "bol_setpoint_c": shipment.bol_setpoint_c,
                        "lots": [{"lot_id": lot_id, "kg": kg} for lot_id, kg in shipment.lots],
                        "eta_at": iso(arrive),
                    }
                ]
            },
            f"plan {sid}",
        )
        event(sid, depart - timedelta(minutes=30), "LOADING", kind="STATUS", status="LOADING")
        shipper = trip.lot(shipment.lots[0][0]).segment_at(depart - timedelta(seconds=1))
        event(
            sid,
            depart,
            "LOAD",
            kind="CUSTODY",
            custody_event_type="LOAD",
            from_party_id=shipper.holder_party_id,
            to_party_id=shipment.carrier_party_id,
            site_id=shipment.origin_site_id,
        )
        junction = _junction(world, first_leg.lane_id or "")
        event(
            sid,
            depart,
            "DEPART",
            kind="STATUS",
            status="IN_TRANSIT",
            eta_at=iso(arrive),
            next_junction_site_id=junction[0] if junction else None,
            junction_passed=False,
        )
        iot(
            depart,
            {
                "source": "bbc-sim",
                "pairings": [
                    {
                        "pairing_id": f"PAIR-{trip.trucks[shipment.truck_id]}-{sid}",
                        "device_id": trip.trucks[shipment.truck_id],
                        "target_type": "SHIPMENT",
                        "target_id": sid,
                        "role": "REEFER",
                        "assigned_from": iso(depart),
                        "changed_at": iso(depart),
                        "provenance": tm.PROVENANCE,
                    }
                ],
            },
            f"pair reefer -> {sid}",
        )
        if junction:
            passed = first_leg.start + timedelta(hours=junction[1])
            event(
                sid,
                passed,
                "JUNCTION",
                kind="STATUS",
                status="IN_TRANSIT",
                junction_passed=True,
                next_junction_site_id=None,
                lat=_position(world, first_leg, passed)[0],
                lon=_position(world, first_leg, passed)[1],
            )
        for leg in shipment.legs:
            if leg.kind == "REEFER":
                t = leg.start + POSITION_EVERY
                while t < leg.end:
                    lat, lon = _position(world, leg, t)
                    event(
                        sid,
                        t,
                        f"POS-{iso(t)}",
                        kind="STATUS",
                        status="IN_TRANSIT",
                        lat=lat,
                        lon=lon,
                        eta_at=iso(arrive),
                    )
                    t += POSITION_EVERY
            else:  # a stop: the truck docks, the stop's holder takes the load, then hands it back
                event(sid, leg.start, f"STOP-{leg.site_id}", kind="STATUS", status="AT_DOCK")
                event(
                    sid,
                    leg.start,
                    f"HANDOFF-{leg.site_id}",
                    kind="CUSTODY",
                    custody_event_type="HANDOFF",
                    from_party_id=shipment.carrier_party_id,
                    to_party_id=leg.holder_party_id,
                    site_id=leg.site_id,
                )
                event(
                    sid,
                    leg.end,
                    f"RELOAD-{leg.site_id}",
                    kind="CUSTODY",
                    custody_event_type="LOAD",
                    from_party_id=leg.holder_party_id,
                    to_party_id=shipment.carrier_party_id,
                    site_id=leg.site_id,
                )
                event(
                    sid,
                    leg.end,
                    f"RESUME-{leg.site_id}",
                    kind="STATUS",
                    status="IN_TRANSIT",
                    eta_at=iso(arrive),
                )
        receiver = _holder_after(trip, shipment, arrive)
        event(sid, arrive, "ARRIVE", kind="STATUS", status="AT_DOCK")
        event(
            sid,
            arrive,
            "UNLOAD",
            kind="CUSTODY",
            custody_event_type="UNLOAD",
            from_party_id=shipment.carrier_party_id,
            to_party_id=receiver,
            site_id=shipment.destination_site_id,
        )
        delivered = arrive + timedelta(minutes=30)
        event(sid, delivered, "DELIVERED", kind="STATUS", status="DELIVERED")
        iot(
            arrive,
            {
                "source": "bbc-sim",
                "pairings": [
                    {
                        "pairing_id": f"PAIR-{trip.trucks[shipment.truck_id]}-{sid}",
                        "device_id": trip.trucks[shipment.truck_id],
                        "target_type": "SHIPMENT",
                        "target_id": sid,
                        "role": "REEFER",
                        "assigned_from": iso(depart),
                        "assigned_to": iso(arrive),
                        "changed_at": iso(arrive),
                        "provenance": tm.PROVENANCE,
                    }
                ],
            },
            f"unpair reefer <- {sid}",
        )

        # SAP: stock in transit, and the outbound delivery for customer orders
        dest_plant = keys.plant.get(shipment.destination_site_id)
        for lot_id, kg in shipment.lots:
            lot = trip.lot(lot_id)
            origin_plant = keys.plant.get(lot.packhouse_site_id or "")
            if origin_plant:
                stock(depart, origin_plant, lot, "01", 0, f"stock {lot_id} departs")
                stock(depart, origin_plant, lot, "06", kg, f"stock {lot_id} in transit")
                stock(arrive, origin_plant, lot, "06", 0, f"stock {lot_id} arrives")
            if dest_plant:
                stock(arrive, dest_plant, lot, "01", kg, f"stock {lot_id} received")
        for order in [o for o in trip.orders if o.shipment_id == sid]:
            doc = _number("80", sid, 6)
            header = {
                "DeliveryDocument": doc,
                "ShipToParty": keys.ship_to[order.ship_to_site_id],
                "PlannedGoodsIssueDate": iso(depart),
                "YY1_TMSShipment": sid,
            }
            s4(
                depart - timedelta(minutes=30),
                "/__sim/deliveries",
                {
                    "records": [
                        {
                            **header,
                            "OverallGoodsMovementStatus": "A",
                            "items": [
                                {
                                    "DeliveryDocumentItem": "10",
                                    "ReferenceSDDocument": order.sales_order,
                                    "ReferenceSDDocumentItem": order.item,
                                    "Material": keys.material[order.product_id],
                                    "Batch": order.lot_id,
                                    "ActualDeliveryQuantity": order.kg,
                                    "DeliveryQuantityUnit": "KG",
                                }
                            ],
                        }
                    ]
                },
                f"delivery {doc}",
            )
            s4(
                depart,
                "/__sim/deliveries",
                {"records": [{**header, "OverallGoodsMovementStatus": "C"}]},
                f"goods issue {doc}",
            )
            s4(
                depart,
                "/__sim/sales-orders",
                {
                    "records": [
                        {
                            "SalesOrder": order.sales_order,
                            "items": [{"SalesOrderItem": order.item, "SDProcessStatus": "B"}],
                        }
                    ]
                },
                f"order {order.sales_order} shipped",
            )
            s4(
                delivered,
                "/__sim/deliveries",
                {"records": [{**header, "OverallProofOfDeliveryStatus": "C"}]},
                f"POD {doc}",
            )
            s4(
                delivered,
                "/__sim/sales-orders",
                {
                    "records": [
                        {
                            "SalesOrder": order.sales_order,
                            "items": [{"SalesOrderItem": order.item, "SDProcessStatus": "C"}],
                        }
                    ]
                },
                f"order {order.sales_order} delivered",
            )

    return sorted(acts, key=lambda a: (a.at, a.system, a.label))


# ---------------------------------------------------------------------------- execution
@dataclass
class Endpoints:
    s4_url: str = "http://127.0.0.1:4004"
    s4_user: str = "BBC_CONNECTOR"
    s4_password: str = "mock"
    tms_url: str = "http://127.0.0.1:4005"
    tms_token: str = "mock-tms-token"
    iot_url: str = "http://127.0.0.1:8787"
    iot_secret: str = ""


Transport = Callable[[str, str, dict[str, str], bytes | None], tuple[int, bytes]]


def http_transport(
    method: str, url: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


@dataclass
class RunReport:
    actions: int = 0
    by_system: dict[str, int] = field(default_factory=dict)
    telemetry: tm.DeliveryReport = field(default_factory=tm.DeliveryReport)


class WorldRunner:
    def __init__(
        self,
        endpoints: Endpoints,
        transport: Transport = http_transport,
        now: Callable[[], float] = time.time,
    ):
        self.e = endpoints
        self.transport = transport
        self.now = now
        self.clocks: dict[str, str] = {}

    def _call(
        self, method: str, url: str, headers: dict[str, str], body: dict[str, Any] | None
    ) -> dict[str, Any]:
        data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        status, raw = self.transport(
            method, url, {"Content-Type": "application/json", **headers}, data
        )
        if status >= 300:
            raise RuntimeError(f"{method} {url} -> {status}: {raw.decode(errors='replace')[:500]}")
        return json.loads(raw or b"{}")

    def _s4(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        auth = "Basic " + b64encode(f"{self.e.s4_user}:{self.e.s4_password}".encode()).decode()
        return self._call(method, self.e.s4_url + path, {"Authorization": auth}, body)

    def _tms(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        return self._call(
            method, self.e.tms_url + path, {"Authorization": f"Bearer {self.e.tms_token}"}, body
        )

    def _iot(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        text = json.dumps(body, separators=(",", ":"))
        ts = str(int(self.now()))
        headers = {
            "X-BBC-Timestamp": ts,
            "X-BBC-Signature": tm.signature(self.e.iot_secret, ts, text),
        }
        status, raw = self.transport(
            "POST",
            self.e.iot_url + path,
            {"Content-Type": "application/json", **headers},
            text.encode(),
        )
        if status >= 300:
            raise RuntimeError(f"POST {path} -> {status}: {raw.decode(errors='replace')[:500]}")
        answer = json.loads(raw or b"{}")
        if answer.get("rejected"):
            raise RuntimeError(f"pairing rejected: {answer['rejected']}")
        return answer

    def reset(self) -> None:
        self._s4("POST", "/__sim/reset", {})
        self._tms("POST", "/__sim/reset", {})
        self.clocks.clear()

    def _clock(self, system: str, at: datetime) -> None:
        stamp = at.isoformat()
        if self.clocks.get(system) == stamp:
            return
        (self._s4 if system == "S4" else self._tms)("PUT", "/__sim/clock", {"now": stamp})
        self.clocks[system] = stamp

    def apply(self, action: Action) -> None:
        if action.system == "IOT":
            self._iot(action.path, action.body)
            return
        self._clock(action.system, action.at)
        (self._s4 if action.system == "S4" else self._tms)(action.method, action.path, action.body)

    def run(
        self,
        actions: list[Action],
        messages: list[dict[str, Any]],
        *,
        pace: str = "fast",
        clock_factor: float = 60.0,
        batch_size: int = 500,
        post: Callable[..., tm.DeliveryReport] = tm.post_messages,
    ) -> RunReport:
        report = RunReport()
        pending = sorted(messages, key=lambda m: (m["ts"], m["device_id"]))
        clock = SimClock(
            start=min([a.at for a in actions] + [utc(m["ts"]) for m in pending[:1]]),
            factor=clock_factor,
        )
        if pace == "live":
            clock.begin()

        def flush(until: datetime | None) -> None:
            nonlocal pending
            stamp = iso(until) if until else "~"
            ready = [m for m in pending if m["ts"] <= stamp]
            pending = pending[len(ready) :]
            if not ready:
                return
            if pace == "live":
                # One reading instant at a time, released when simulated time reaches it.
                for ts, group in groupby(ready, key=lambda m: m["ts"]):
                    clock.wait_until(utc(ts))
                    self._merge(
                        report.telemetry,
                        post(self.e.iot_url + "/v1/telemetry", self.e.iot_secret, list(group)),
                    )
            else:
                self._merge(
                    report.telemetry,
                    post(
                        self.e.iot_url + "/v1/telemetry",
                        self.e.iot_secret,
                        ready,
                        batch_size=batch_size,
                    ),
                )

        for action in actions:
            flush(action.at)
            if pace == "live":
                clock.wait_until(action.at)
            self.apply(action)
            report.actions += 1
            report.by_system[action.system] = report.by_system.get(action.system, 0) + 1
        flush(None)
        return report

    @staticmethod
    def _merge(total: tm.DeliveryReport, part: tm.DeliveryReport) -> None:
        total.batches += part.batches
        total.sent += part.sent
        total.accepted += part.accepted
        total.rejected.extend(part.rejected)
