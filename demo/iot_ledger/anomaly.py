"""SKILL 2  coldchain-anomaly-detector

Runs on VERIFIED readings only (quarantined data can neither raise nor hide an alarm).
Detectors, per shipment in time order:
  TEMP_EXCURSION   pulp temp > 1.8 C (the semantic view's compliance limit), runs >= 10 min
  DOOR_OPEN        door flag runs >= 10 min
  GPS_JUMP         implied speed between fixes > 130 km/h (spoofed or faulty GNSS)
  SENSOR_FLATLINE  identical pulp temp for >= 60 min (stuck probe: readings can't be trusted)
  STAT_OUTLIER     return-air robust z-score (median/MAD) > 6, outside door-open windows
Shipment risk = sum of severity weights (CRITICAL 60, HIGH 30, WARN 15, INFO 5), capped at 100;
verdict HOLD >= 60, INSPECT >= 25, else RELEASE  (same scale as LEDGER.V_SHIPMENT_TRUST).
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import datetime

from . import common as c

WEIGHT = {"CRITICAL": 60, "HIGH": 30, "WARN": 15, "INFO": 5}


def _ts(r):
    return datetime.fromisoformat(r["ts"])


def _runs(rows, pred):
    """Contiguous runs of rows satisfying pred (contiguity = consecutive verified readings)."""
    run = []
    for r in rows:
        if pred(r):
            run.append(r)
        elif run:
            yield run
            run = []
    if run:
        yield run


def _haversine_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def detect(rows: list[dict]) -> list[dict]:
    rows = sorted(rows, key=lambda r: r["seq"])
    shp, dev = rows[0]["shipment_id"], rows[0]["device_id"]
    events = []

    def add(kind, sev, run, evidence):
        events.append({"anomaly_id": f"ANM-{shp[-8:]}-{len(events) + 1:02d}", "shipment_id": shp, "device_id": dev,
                       "type": kind, "severity": sev, "start_ts": run[0]["ts"], "end_ts": run[-1]["ts"],
                       "duration_min": len(run) * c.INTERVAL_MIN, "evidence": evidence})

    hot = [run for run in _runs(rows, lambda r: r["pulp_temp_c"] > c.TEMP_LIMIT_C) if len(run) * c.INTERVAL_MIN >= 10]
    if hot:
        minutes = sum(len(run) for run in hot) * c.INTERVAL_MIN
        peak = max(r["pulp_temp_c"] for run in hot for r in run)
        dm = sum((r["pulp_temp_c"] - c.TEMP_LIMIT_C) * c.INTERVAL_MIN for run in hot for r in run)
        sev = "CRITICAL" if minutes >= 120 or peak >= 4.0 else "HIGH" if minutes >= 60 else "WARN"
        add("TEMP_EXCURSION", sev, [r for run in hot for r in run],
            {"minutes_above": minutes, "hours_above": round(minutes / 60, 2), "peak_c": peak, "degree_minutes": round(dm, 1),
             "limit_c": c.TEMP_LIMIT_C, "readings": sum(len(run) for run in hot)})

    door_windows = []
    for run in _runs(rows, lambda r: r["door_open"]):
        mins = len(run) * c.INTERVAL_MIN
        if mins >= 10:
            door_windows.append((run[0]["seq"], run[-1]["seq"]))
            add("DOOR_OPEN", "HIGH" if mins >= 20 else "WARN", run,
                {"minutes_open": mins, "max_return_air_c": max(r["return_air_c"] for r in run),
                 "pulp_rise_c": round(run[-1]["pulp_temp_c"] - run[0]["pulp_temp_c"], 2)})

    jumps = []
    for a, b in zip(rows, rows[1:]):
        hours = (_ts(b) - _ts(a)).total_seconds() / 3600
        km = _haversine_km(a, b)
        if hours > 0 and km / hours > 130:
            jumps.append((b, km, km / hours))
    if jumps:
        add("GPS_JUMP", "HIGH", [j[0] for j in jumps],
            {"fixes": len(jumps), "max_jump_km": round(max(j[1] for j in jumps), 1),
             "implied_kmh": round(max(j[2] for j in jumps)), "at": jumps[0][0]["ts"]})

    for run in _runs(list(zip(rows, rows[1:])), lambda p: p[0]["pulp_temp_c"] == p[1]["pulp_temp_c"]):
        readings = [run[0][0]] + [p[1] for p in run]
        if len(readings) * c.INTERVAL_MIN >= 60:
            add("SENSOR_FLATLINE", "WARN", readings, {"stuck_value_c": readings[0]["pulp_temp_c"], "readings": len(readings)})

    ra = [r["return_air_c"] for r in rows]
    med = statistics.median(ra)
    mad = statistics.median(abs(x - med) for x in ra) or 1e-6
    for r in rows:
        z = 0.6745 * (r["return_air_c"] - med) / mad
        in_door = any(lo <= r["seq"] <= hi for lo, hi in door_windows)
        in_hot = r["pulp_temp_c"] > c.TEMP_LIMIT_C
        if abs(z) > 6 and not in_door and not in_hot:
            add("STAT_OUTLIER", "WARN", [r], {"return_air_c": r["return_air_c"], "median_c": round(med, 2), "robust_z": round(z, 1)})
    return events


def score(events) -> tuple[int, str]:
    s = min(100, sum(WEIGHT[e["severity"]] for e in events))
    return s, "HOLD" if s >= 60 else "INSPECT" if s >= 25 else "RELEASE"


def describe(e) -> str:
    ev = e["evidence"]
    return {
        "TEMP_EXCURSION": lambda: f"{ev['hours_above']} h above {ev['limit_c']}°C, peak {ev['peak_c']}°C, {ev['degree_minutes']} °C·min",
        "DOOR_OPEN": lambda: f"door open {ev['minutes_open']} min, return air {ev['max_return_air_c']}°C, pulp +{ev['pulp_rise_c']}°C",
        "GPS_JUMP": lambda: f"{ev['max_jump_km']} km jump at {ev['at'][11:16]} (implied {ev['implied_kmh']:,} km/h)",
        "SENSOR_FLATLINE": lambda: f"probe stuck at {ev['stuck_value_c']}°C for {e['duration_min']} min",
        "STAT_OUTLIER": lambda: f"return air {ev['return_air_c']}°C vs median {ev['median_c']}°C (z={ev['robust_z']})",
    }[e["type"]]()


def run(run_id: str) -> None:
    rd = c.run_dir(run_id)
    verified = c.read_jsonl(rd / "verified.jsonl")
    c.banner("SKILL 2/3", "coldchain-anomaly-detector", "excursion · door-open · GPS spoof · stuck sensor · robust z-score  —  verified data only")
    c.status_line({"INPUT": "done", "VALIDATE": "done", "DETECT": "run", "SYNC+ATTEST": "todo"})

    by_shp = defaultdict(list)
    for r in verified:
        by_shp[r["shipment_id"]].append(r)

    c.section(f"Scanning {len(verified)} verified readings across {len(by_shp)} shipments  (limit {c.TEMP_LIMIT_C}°C, {c.INTERVAL_MIN}-min cadence)")
    all_events, summary = [], []
    for i, (shp, rows) in enumerate(sorted(by_shp.items()), 1):
        events = detect(rows)
        all_events += events
        s, verdict = score(events)
        summary.append({"shipment_id": shp, "readings": len(rows), "anomalies": len(events), "risk": s, "verdict": verdict})
        c.progress(f"detect {shp[-8:]}", i, len(by_shp), f"{len(events)} " + ("anomaly" if len(events) == 1 else "anomalies"))
        c.pause(0.5)

    c.section("Anomalies")
    for e in all_events:
        col = c.SEV_COLOR[e["severity"]]
        c.out(f"  {col}{e['severity']:<8}{c.RESET} {c.BOLD}{e['type']:<16}{c.RESET} {e['shipment_id']}  {e['start_ts'][11:16]}–{e['end_ts'][11:16]}  {describe(e)}")
        c.pause(0.45)

    c.section("Shipment risk verdicts")
    rows = [[x["shipment_id"], x["readings"], x["anomalies"], x["risk"], x["verdict"]] for x in summary]
    colors = [[None, None, None, None, c.VERDICT_COLOR[x["verdict"]]] for x in summary]
    c.table(["shipment", "verified readings", "anomalies", "risk", "verdict"], rows, colors)

    import json
    (rd / "anomalies.json").write_text(json.dumps({"events": all_events, "summary": summary}, indent=2))
    holds = [x for x in summary if x["verdict"] == "HOLD"]
    c.out()
    c.ok(f"{c.BOLD}{len(all_events)} anomalies{c.RESET} on verified data   "
         f"{c.RED}{c.BOLD}{len(holds)} HOLD{c.RESET}  {c.YELLOW}{c.BOLD}{sum(x['verdict'] == 'INSPECT' for x in summary)} INSPECT{c.RESET}  "
         f"{c.GREEN}{c.BOLD}{sum(x['verdict'] == 'RELEASE' for x in summary)} RELEASE{c.RESET}")
    c.status_line({"INPUT": "done", "VALIDATE": "done", "DETECT": "done", "SYNC+ATTEST": "todo"})
