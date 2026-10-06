"""Run a trip through the thermal model and report what its devices would send.

``simulate`` steps the world once a minute and emits webhook messages
(contracts/schemas/connectors/iot_webhook.json): the lot's PRIMARY pulp probe every
5 minutes, and each active reefer unit every 5 minutes. The ground truth (true pulp,
true shelf life) goes into ``SimResult.truth`` only - it reaches Snowflake later, and
only the way it would in reality: through receipt QC inspections.

``post_messages`` delivers messages to connector-iot exactly as a device platform
would: signed batches, retried on 5xx and connection errors. The simulator never
writes to Snowflake directly.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import random
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from blueberrychain.sim.clock import iso
from blueberrychain.sim.thermal import ReeferState, draw_truth
from blueberrychain.sim.trip import Trip

STEP_S = 60
PROVENANCE = "SIMULATION_LIVE"


@dataclass
class SimResult:
    trip: Trip
    messages: list[dict[str, Any]] = field(default_factory=list)
    truth: dict[str, Any] = field(default_factory=dict)


def _site_coords(world: dict[str, Any]) -> dict[str, tuple[float, float]]:
    return {s["site_id"]: (s["lat"], s["lon"]) for s in world["sites"]}


def _position(world, coords, seg, moment) -> tuple[float, float]:
    lane = next(lane for lane in world["lanes"] if lane["lane_id"] == seg.lane_id)
    (a_lat, a_lon), (b_lat, b_lon) = coords[lane["origin_site_id"]], coords[lane["dest_site_id"]]
    f = (moment - seg.start) / (seg.end - seg.start)
    return round(a_lat + (b_lat - a_lat) * f, 4), round(a_lon + (b_lon - a_lon) * f, 4)


def _on_grid(moment: datetime, interval_s: int) -> bool:
    return int(moment.timestamp()) % interval_s == 0


def simulate(world: dict[str, Any], trip: Trip, seed: int | None = None) -> SimResult:
    """Deterministic for a given world, trip and seed."""
    cfg = world["thermal"]
    seed = world["meta"]["seed"] if seed is None else seed
    products = {p["product_id"]: p for p in world["products"]}
    coords = _site_coords(world)
    rng = {
        name: random.Random(f"{seed}:{trip.scenario}:{name}")
        for name in [lot.lot_id for lot in trip.lots]
        + [lot.probe_device_id for lot in trip.lots]
        + list(trip.trucks)
    }

    truths = {
        lot.lot_id: draw_truth(
            products[lot.product_id],
            lot.lot_id,
            lot.segments[0].ambient_c,
            cfg["truth"]["q10_sigma"],
            rng[lot.lot_id],
        )
        for lot in trip.lots
    }
    reefer_spans = {
        truck: (
            min(s.start for lot in trip.lots for s in lot.segments if s.truck_id == truck),
            max(s.end for lot in trip.lots for s in lot.segments if s.truck_id == truck),
        )
        for truck in trip.trucks
    }
    reefers: dict[str, ReeferState] = {}
    result = SimResult(trip=trip)
    probe_iv, reefer_iv = cfg["probe"]["interval_s"], cfg["reefer_interval_s"]

    t = trip.start
    while t < trip.end:
        nxt = t + timedelta(seconds=STEP_S)
        # 1. Trailers (air first: the fruit responds to it).
        for truck, device in trip.trucks.items():
            span = reefer_spans[truck]
            if not span[0] <= t < span[1]:
                continue
            lots_here = [
                lot
                for lot in trip.lots
                if (seg := lot.segment_at(t)) and (seg.truck_id == truck or seg.kind == "DOCK")
            ]
            seg = next((s for lot in lots_here if (s := lot.segment_at(t))), None)
            setpoint = next(
                (f.params["setpoint_c"] for f in trip.faults_for(truck, "setpoint_error")),
                cfg["room_setpoint_c"],
            )
            state = reefers.setdefault(
                truck, ReeferState(truck, device, air_c=setpoint + 0.3, setpoint_c=setpoint)
            )
            hours_on = (t - span[0]).total_seconds() / 3600
            cycle = cfg["reefer"]["defrost_every_h"]
            state.step(
                cfg["reefer"],
                STEP_S,
                ambient_c=seg.ambient_c if seg else 20.0,
                pulp_c=sum(truths[lot.lot_id].pulp_c for lot in lots_here) / max(len(lots_here), 1),
                compressor_ok=not any(
                    f.active(t) for f in trip.faults_for(truck, "reefer_compressor_failure")
                ),
                defrost_stuck=any(f.active(t) for f in trip.faults_for(truck, "defrost_stuck")),
                door_open=bool(seg and seg.kind == "DOCK"),
                defrost_cycle=hours_on > 0.5
                and (hours_on % cycle) * 60 < cfg["reefer"]["defrost_min"],
                rng=rng[truck],
            )
        # 2. Lots.
        for lot in trip.lots:
            seg = lot.segment_at(t)
            if seg is None:
                continue
            truth = truths[lot.lot_id]
            tau = cfg["pulp_tau_h"][seg.kind]
            if seg.kind == "REEFER":
                target = reefers[seg.truck_id].mean_air_c
            elif seg.kind in ("PRECOOL", "COLD_STORE", "DC_COLD"):
                target = cfg["room_setpoint_c"]
            else:
                target = seg.ambient_c
            truth.step(target, tau, STEP_S)
        t = nxt
        # 3. Readings that close an interval at this instant.
        for lot in trip.lots:
            seg = lot.segment_at(t - timedelta(seconds=1))
            if (
                seg is None
                or t < lot.harvest_at + timedelta(minutes=10)
                or not _on_grid(t, probe_iv)
            ):
                continue
            if any(f.active(t) for f in trip.faults_for(lot.lot_id, "probe_dropout")):
                continue
            bias = sum(f.params["bias_c"] for f in trip.faults_for(lot.lot_id, "probe_misplaced"))
            r = rng[lot.probe_device_id]
            age_days = (t - lot.harvest_at).total_seconds() / 86400
            result.messages.append(
                {
                    "device_id": lot.probe_device_id,
                    "ts": iso(t),
                    "interval_s": probe_iv,
                    "values": {
                        "pulp_c": round(
                            truths[lot.lot_id].pulp_c + bias + r.gauss(0, cfg["probe"]["noise_c"]),
                            2,
                        ),
                        "battery_pct": round(
                            max(100 - age_days * cfg["probe"]["battery_drain_pct_per_day"], 0), 1
                        ),
                    },
                    "provenance": PROVENANCE,
                }
            )
        for truck, state in sorted(reefers.items()):
            span = reefer_spans[truck]
            if not span[0] < t <= span[1] or not _on_grid(t, reefer_iv):
                continue
            seg = next(
                (
                    s
                    for lot in trip.lots
                    if (s := lot.segment_at(t - timedelta(seconds=1)))
                    and (s.truck_id == truck or s.kind == "DOCK")
                ),
                None,
            )
            values: dict[str, Any] = {
                "supply_air_c": round(state.supply_c, 2),
                "return_air_c": round(state.return_c, 2),
                "setpoint_c": state.setpoint_c,
                "ambient_c": seg.ambient_c if seg else 20.0,
                "mode": state.mode,
                "door_open": state.door_open,
                "alarms": list(state.alarms),
            }
            if seg and seg.kind == "REEFER":
                values["lat"], values["lon"] = _position(world, coords, seg, t)
            elif seg and seg.site_id:
                values["lat"], values["lon"] = coords[seg.site_id]
            result.messages.append(
                {
                    "device_id": state.device_id,
                    "ts": iso(t),
                    "interval_s": reefer_iv,
                    "values": values,
                    "provenance": PROVENANCE,
                }
            )
    result.truth = {
        "scenario": trip.scenario,
        "seed": seed,
        "as_of": iso(trip.end),
        "lots": {lot_id: truth.summary() for lot_id, truth in truths.items()},
    }
    return result


def window(
    messages: Iterable[dict[str, Any]], start: datetime | None, end: datetime | None
) -> list[dict[str, Any]]:
    """Messages with start <= ts < end (ISO-Z strings of one format compare in time order)."""
    lo = iso(start) if start else ""
    hi = iso(end) if end else "~"
    return [m for m in messages if lo <= m["ts"] < hi]


# ---------------------------------------------------------------------------- delivery
def signature(secret: str, timestamp: str, body: str) -> str:
    """contracts/vectors/webhook_signature.json: v1=hex(HMAC-SHA256(secret, ts + '.' + body))."""
    return (
        "v1="
        + hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    )


@dataclass
class DeliveryReport:
    batches: int = 0
    sent: int = 0
    accepted: int = 0
    rejected: list[dict[str, Any]] = field(default_factory=list)


def post_messages(
    url: str,
    secret: str,
    messages: list[dict[str, Any]],
    *,
    batch_size: int = 200,
    attempts: int = 5,
    before_batch: Callable[[list[dict[str, Any]]], None] | None = None,
    now: Callable[[], float] = time.time,
    sleep: Callable[[float], None] = time.sleep,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> DeliveryReport:
    report = DeliveryReport()
    for i in range(0, len(messages), batch_size):
        chunk = messages[i : i + batch_size]
        if before_batch:
            before_batch(chunk)
        body = json.dumps({"source": "bbc-sim", "messages": chunk}, separators=(",", ":"))
        for attempt in range(1, attempts + 1):
            ts = str(int(now()))
            request = urllib.request.Request(
                url,
                data=body.encode(),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "X-BBC-Timestamp": ts,
                    "X-BBC-Signature": signature(secret, ts, body),
                },
            )
            try:
                with opener(request, timeout=60) as response:
                    answer = json.loads(response.read() or b"{}")
                break
            except urllib.error.HTTPError as exc:
                if exc.code < 500 or attempt == attempts:
                    detail = exc.read().decode(errors="replace")
                    raise RuntimeError(f"webhook refused the batch ({exc.code}): {detail}") from exc
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                if attempt == attempts:
                    raise
            sleep(min(2 ** (attempt - 1), 10))
        report.batches += 1
        report.sent += len(chunk)
        report.accepted += int(answer.get("accepted", 0))
        report.rejected.extend(answer.get("rejected", []))
    return report
