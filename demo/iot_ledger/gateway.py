"""INPUT stage: provision loggers, then pull and land the overnight IoT gateway dump.

The gateway is simulated: it writes the JSONL files a reefer fleet gateway would export,
for the real IN_TRANSIT shipments in BLUEBERRY_CHAIN.RAW.SHIPMENTS. Deterministic injections
give the validator and detector something real to find:

  integrity (skill 1)                         cold chain (skill 2)
  RANCH-14  excursion reading rewritten        RANCH-14  3.8 h pulp temp above 1.8 C
  RANCH-05  temperature edited, no re-hash     RANCH-04  reefer door open 28 min
  RANCH-10  reading re-sent (replay)           RANCH-10  GPS fix jumps ~180 km
  RANCH-02  one reading deleted in transit     RANCH-07  probe flatlined for 90 min
  rogue     unregistered logger injects data   RANCH-02  return-air spike
"""
from __future__ import annotations

import json
import math
import random
from datetime import datetime, timedelta

from . import common as c

PINNED_RANCHES = ("RANCH-14", "RANCH-04", "RANCH-10", "RANCH-07", "RANCH-02", "RANCH-05")
TRACY_DC = (37.7397, -121.4252)
REGION_BEARING = {"San Joaquin CA": 135, "Central Valley CA": 150, "Salinas Valley CA": 200, "Monterey County CA": 210}
ROGUE_DEVICE = "TAG-RFR-099"
READINGS = 361  # 12 h at 2-minute interval, inclusive

SHIPMENT_SQL = f"""
SELECT s.SHIPMENT_ID, s.LOT_ID, s.ORIGIN_RANCH_ID, s.REEFER_ID, s.CARRIER, s.DEPART_TS, s.SHIPPED_KG,
       r.REGION, r.DISTANCE_TO_DC_KM
FROM BLUEBERRY_CHAIN.RAW.SHIPMENTS s
JOIN BLUEBERRY_CHAIN.RAW.RANCHES r ON r.RANCH_ID = s.ORIGIN_RANCH_ID
WHERE s.STATUS = 'IN_TRANSIT' AND s.DC_CODE = 'TRACY-DC'
  AND s.ORIGIN_RANCH_ID IN ({','.join("'" + r + "'" for r in PINNED_RANCHES)})
QUALIFY ROW_NUMBER() OVER (PARTITION BY s.ORIGIN_RANCH_ID ORDER BY s.DEPART_TS DESC, s.SHIPMENT_ID DESC) = 1
ORDER BY s.ORIGIN_RANCH_ID
"""


def fetch_shipments(conn) -> list[dict]:
    cur = conn.cursor()
    cur.execute(SHIPMENT_SQL)
    cols = [d[0].lower() for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def device_for(shipment: dict) -> str:
    return f"TAG-{shipment['reefer_id']}"


# ---------------------------------------------------------------- provisioning
def setup() -> None:
    """Register each logger's public key + genesis hash. Runs at device install time, not per run."""
    conn = c.connect()
    shipments = fetch_shipments(conn)
    cur = conn.cursor()
    for s in shipments:
        dev = device_for(s)
        cur.execute(
            f"""MERGE INTO {c.LEDGER}.DEVICE_REGISTRY t
                USING (SELECT %s AS DEVICE_ID, %s AS REEFER_ID, %s AS SHIPMENT_ID, %s AS PK, %s AS GH) src
                ON t.DEVICE_ID = src.DEVICE_ID
                WHEN MATCHED THEN UPDATE SET REEFER_ID = src.REEFER_ID, SHIPMENT_ID = src.SHIPMENT_ID,
                     PUBLIC_KEY_HEX = src.PK, GENESIS_HASH = src.GH, STATUS = 'ACTIVE', REGISTERED_TS = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (DEVICE_ID, REEFER_ID, SHIPMENT_ID, PUBLIC_KEY_HEX, GENESIS_HASH)
                     VALUES (src.DEVICE_ID, src.REEFER_ID, src.SHIPMENT_ID, src.PK, src.GH)""",
            (dev, s["reefer_id"], s["shipment_id"], c.pubkey_hex(c.device_key(dev)), c.genesis_hash(dev)))
        c.ok(f"registered {dev:<12} -> {s['shipment_id']}  ed25519 {c.pubkey_hex(c.device_key(dev))[:16]}…")
    conn.close()


# ---------------------------------------------------------------- simulation
def _start_point(region: str, dist_km: float) -> tuple[float, float]:
    b = math.radians(REGION_BEARING.get(region, 180))
    dlat = dist_km * math.cos(b) / 111.0
    dlon = dist_km * math.sin(b) / (111.0 * math.cos(math.radians(TRACY_DC[0])))
    return TRACY_DC[0] + dlat, TRACY_DC[1] + dlon


def _excursion_temp(i: int) -> float:
    """RANCH-14: 116 readings above 1.8 C between i=120 and i=235, peaking ~4.6 C."""
    if 120 <= i <= 235:
        x = (i - 120) / 115
        return 1.95 + 2.65 * math.sin(math.pi * x)
    return None


def _sign(rec: dict, key) -> dict:
    rec["entry_hash"] = c.entry_hash(rec)
    rec["signature"] = key.sign(bytes.fromhex(rec["entry_hash"])).hex()
    return rec


def simulate_device(s: dict) -> list[dict]:
    dev = device_for(s)
    ranch = s["origin_ranch_id"]
    rng = random.Random(f"bbc:{dev}:{s['shipment_id']}")
    key = c.device_key(dev)
    lat0, lon0 = _start_point(s["region"], float(s["distance_to_dc_km"]))
    depart = s["depart_ts"] if isinstance(s["depart_ts"], datetime) else datetime.fromisoformat(str(s["depart_ts"]))
    prev, recs = c.genesis_hash(dev), []
    for i in range(READINGS):
        f = i / (READINGS - 1)
        lat = lat0 + (TRACY_DC[0] - lat0) * f + rng.gauss(0, 0.0004)
        lon = lon0 + (TRACY_DC[1] - lon0) * f + rng.gauss(0, 0.0004)
        pulp = 0.95 + 0.12 * math.sin(i / 45) + rng.gauss(0, 0.05)
        ret = 0.70 + rng.gauss(0, 0.10)
        door = False
        if ranch == "RANCH-14" and _excursion_temp(i) is not None:
            pulp = _excursion_temp(i) + rng.gauss(0, 0.04)
            ret = pulp + 0.6 + rng.gauss(0, 0.1)
        if ranch == "RANCH-04" and 140 <= i <= 153:
            door = True
            ret = 6.5 + rng.gauss(0, 0.6)
            pulp = 1.15 + 0.035 * (i - 140)
        if ranch == "RANCH-07" and 80 <= i <= 124:
            pulp = 1.02
        if ranch == "RANCH-02" and i == 300:
            ret = 7.4
        if ranch == "RANCH-10" and i == 200:
            lat, lon = lat + 1.62, lon + 0.15
        rec = {
            "event_id": f"{dev}-{i + 1:05d}",
            "device_id": dev,
            "shipment_id": s["shipment_id"],
            "seq": i + 1,
            "ts": (depart + timedelta(minutes=c.INTERVAL_MIN * i)).strftime("%Y-%m-%dT%H:%M:%S"),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "pulp_temp_c": round(pulp, 2),
            "return_air_c": round(ret, 2),
            "door_open": door,
            "prev_hash": prev,
        }
        _sign(rec, key)
        prev = rec["entry_hash"]
        recs.append(rec)

    # ---- integrity injections (after signing: this is what an attacker / faulty link does)
    if ranch == "RANCH-14":
        r = recs[159]                     # inside the excursion: hide it, re-hash, cannot re-sign
        r["pulp_temp_c"] = 1.21
        r["entry_hash"] = c.entry_hash(r)
    if ranch == "RANCH-05":
        recs[99]["pulp_temp_c"] = round(recs[99]["pulp_temp_c"] - 0.5, 2)   # naive edit, hash left stale
    if ranch == "RANCH-02":
        del recs[209]                     # dropped in transit -> seq gap
    if ranch == "RANCH-10":
        recs.insert(252, dict(recs[249]))  # gateway retry re-sends seq 250 after 252
    return recs


def simulate_rogue(target: dict) -> list[dict]:
    key = c.device_key(ROGUE_DEVICE)
    depart = target["depart_ts"] if isinstance(target["depart_ts"], datetime) else datetime.fromisoformat(str(target["depart_ts"]))
    prev, recs = c.genesis_hash(ROGUE_DEVICE), []
    for i in range(3):
        rec = {"event_id": f"{ROGUE_DEVICE}-{i + 1:05d}", "device_id": ROGUE_DEVICE, "shipment_id": target["shipment_id"],
               "seq": i + 1, "ts": (depart + timedelta(minutes=300 + 2 * i)).strftime("%Y-%m-%dT%H:%M:%S"),
               "lat": 37.41, "lon": -121.02, "pulp_temp_c": 0.9, "return_air_c": 0.7, "door_open": False, "prev_hash": prev}
        _sign(rec, key)
        prev = rec["entry_hash"]
        recs.append(rec)
    return recs


# ---------------------------------------------------------------- ingest command
REQUIRED = {"event_id": str, "device_id": str, "shipment_id": str, "seq": int, "ts": str, "lat": float, "lon": float,
            "pulp_temp_c": float, "return_air_c": float, "door_open": bool, "prev_hash": str,
            "entry_hash": str, "signature": str}


def ingest(run_id: str) -> None:
    rd = c.run_dir(run_id)
    (c.RUNS_DIR / "LATEST").write_text(rd.name)
    raw = rd / "raw"
    raw.mkdir(exist_ok=True)

    c.banner("INPUT", "IoT cold-chain gateway ingest", f"run {rd.name}  ·  source: reefer fleet gateway (simulated)  ·  target: {c.LEDGER}")
    c.status_line({"INPUT": "run", "VALIDATE": "todo", "DETECT": "todo", "SYNC+ATTEST": "todo"})

    c.section("Resolving in-transit manifest from Snowflake  BLUEBERRY_CHAIN.RAW.SHIPMENTS")
    conn = c.connect()
    shipments = fetch_shipments(conn)
    conn.close()
    for s in shipments:
        c.ok(f"{s['shipment_id']}  {s['lot_id']}  {s['origin_ranch_id']} -> TRACY-DC  {s['carrier']:<24} {float(s['shipped_kg']):>8,.0f} kg")
        c.pause(0.25)

    c.section("Pulling overnight logger dumps from gateway")
    dumps = {device_for(s): simulate_device(s) for s in shipments}
    hot = next(s for s in shipments if s["origin_ranch_id"] == "RANCH-14")
    dumps[ROGUE_DEVICE] = simulate_rogue(hot)
    for dev, recs in dumps.items():
        c.write_jsonl(raw / f"{dev}.jsonl", recs)
        size = (raw / f"{dev}.jsonl").stat().st_size
        c.info(f"gateway://fleet/{dev}.jsonl   {len(recs):>4} records   {size / 1024:6.1f} KiB")
        c.pause(0.2)

    c.section("Landing + schema check (13 required fields, typed)")
    landed, bad = [], 0
    files = sorted(raw.glob("*.jsonl"))
    for fi, path in enumerate(files, 1):
        recs = c.read_jsonl(path)
        for r in recs:
            if all(k in r and isinstance(r[k], t if t is not float else (int, float)) for k, t in REQUIRED.items()):
                landed.append(r)
            else:
                bad += 1
        c.progress("parse " + path.stem, fi, len(files), f"{len(landed):>5} landed")
        c.pause(0.35)
    c.write_jsonl(rd / "ingested.jsonl", landed)

    temps = [r["pulp_temp_c"] for r in landed]
    c.section("Raw profile")
    c.table(["records", "devices", "shipments", "window", "pulp temp °C", "door events", "schema rejects"],
            [[len(landed), len({r['device_id'] for r in landed}), len({r['shipment_id'] for r in landed}),
              f"{min(r['ts'] for r in landed)[11:16]} → {max(r['ts'] for r in landed)[11:16]}",
              f"{min(temps):.2f} … {max(temps):.2f}", sum(r["door_open"] for r in landed), bad]])
    c.pause(0.5)

    sample = next(r for r in landed if r["device_id"] == device_for(hot) and r["seq"] == 150)
    c.section("Sample record  (Ed25519-signed, hash-chained)")
    for k in ("event_id", "shipment_id", "seq", "ts", "lat", "lon", "pulp_temp_c", "door_open", "prev_hash", "entry_hash", "signature"):
        v = sample[k]
        shown = (v[:48] + "…") if isinstance(v, str) and len(v) > 52 else v
        c.out(f"    {c.CYAN}{k:<12}{c.RESET} {json.dumps(shown, ensure_ascii=False)}")
        c.pause(0.08)
    c.out()
    c.ok(f"{c.BOLD}{len(landed)} raw readings landed{c.RESET} from {len(files)} logger files -> {rd.name}/ingested.jsonl")
    c.status_line({"INPUT": "done", "VALIDATE": "todo", "DETECT": "todo", "SYNC+ATTEST": "todo"})
