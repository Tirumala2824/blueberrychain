"""SKILL 1  ledger-integrity-validator

Checks every landed reading against the ledger rules, in arrival order, per device:
  R1 UNKNOWN_DEVICE     device must exist in LEDGER.DEVICE_REGISTRY (trust anchor, from Snowflake)
  R2 SHIPMENT_MISMATCH  record's shipment must match the registry and RAW.SHIPMENTS (reefer + IN_TRANSIT)
  R3 HASH_MISMATCH      sha256(canonical payload) must equal the claimed entry_hash
  R4 SIGNATURE_INVALID  Ed25519 signature over entry_hash must verify with the registered key
  R5 REPLAY             seq must be strictly increasing (re-sent readings are dropped)
  R6 CHAIN_GAP          seq must be contiguous (a missing reading breaks the chain)
  R7 CHAIN_BREAK        prev_hash must equal the previous reading's entry_hash
The chain head always advances to the claimed entry_hash, so one bad record is quarantined
without cascading; a gap/break re-anchors the chain at the record that exposed it.
"""
from __future__ import annotations

from collections import Counter, defaultdict

from . import common as c

RULE_TEXT = {
    "UNKNOWN_DEVICE": "logger not in DEVICE_REGISTRY",
    "SHIPMENT_MISMATCH": "shipment does not match registry / manifest",
    "HASH_MISMATCH": "payload altered after hashing",
    "SIGNATURE_INVALID": "Ed25519 signature does not verify",
    "REPLAY": "duplicate / re-sent sequence number",
    "CHAIN_GAP": "reading missing upstream (seq gap)",
    "CHAIN_BREAK": "prev_hash does not link to prior entry",
}


def load_trust_anchor(conn) -> tuple[dict, dict]:
    cur = conn.cursor()
    cur.execute(f"SELECT DEVICE_ID, REEFER_ID, SHIPMENT_ID, PUBLIC_KEY_HEX, GENESIS_HASH FROM {c.LEDGER}.DEVICE_REGISTRY WHERE STATUS = 'ACTIVE'")
    registry = {r[0]: {"reefer": r[1], "shipment": r[2], "pub": r[3], "genesis": r[4]} for r in cur.fetchall()}
    cur.execute("SELECT SHIPMENT_ID, REEFER_ID, STATUS FROM BLUEBERRY_CHAIN.RAW.SHIPMENTS WHERE SHIPMENT_ID IN ("
                + ",".join(["%s"] * len(registry)) + ")", [v["shipment"] for v in registry.values()])
    manifest = {r[0]: {"reefer": r[1], "status": r[2]} for r in cur.fetchall()}
    return registry, manifest


def validate_records(records: list[dict], registry: dict, manifest: dict, on_progress=None):
    verified, rejected = [], []
    head = {}       # device -> (last seq, last claimed entry_hash)
    seen_hash = defaultdict(set)

    def reject(r, rule, detail):
        rejected.append({"event_id": r.get("event_id"), "device_id": r.get("device_id"), "shipment_id": r.get("shipment_id"),
                         "seq": r.get("seq"), "rule": rule, "detail": detail, "raw": r})

    for n, r in enumerate(records, 1):
        if on_progress:
            on_progress(n)
        dev = r["device_id"]
        reg = registry.get(dev)
        if reg is None:
            reject(r, "UNKNOWN_DEVICE", f"{dev} has no registered public key")
            continue
        m = manifest.get(r["shipment_id"])
        if r["shipment_id"] != reg["shipment"] or m is None or m["reefer"] != reg["reefer"] or m["status"] != "IN_TRANSIT":
            reject(r, "SHIPMENT_MISMATCH", f"{r['shipment_id']} not bound to {dev}")
            continue
        last_seq, last_hash = head.get(dev, (0, reg["genesis"]))

        if r["seq"] <= last_seq:
            # never advance the head on a replay
            dup = "identical to accepted entry" if r["entry_hash"] in seen_hash[dev] else "conflicting content"
            reject(r, "REPLAY", f"seq {r['seq']} re-sent after seq {last_seq} ({dup})")
            continue
        head[dev] = (r["seq"], r["entry_hash"])
        seen_hash[dev].add(r["entry_hash"])

        if c.entry_hash(r) != r["entry_hash"]:
            reject(r, "HASH_MISMATCH", f"seq {r['seq']} pulp_temp_c={r['pulp_temp_c']} does not hash to claimed entry")
            continue
        if not c.verify_sig(reg["pub"], r["signature"], r["entry_hash"]):
            reject(r, "SIGNATURE_INVALID", f"seq {r['seq']} pulp_temp_c={r['pulp_temp_c']} re-hashed but not signed by {dev}")
            continue
        if r["seq"] != last_seq + 1:
            missing = f"{last_seq + 1}" if r["seq"] - last_seq == 2 else f"{last_seq + 1}..{r['seq'] - 1}"
            reject(r, "CHAIN_GAP", f"seq {missing} missing upstream; chain re-anchored at seq {r['seq']}")
            continue
        if r["prev_hash"] != last_hash:
            reject(r, "CHAIN_BREAK", f"seq {r['seq']} prev_hash != entry of seq {last_seq}; history rewritten upstream")
            continue
        verified.append(r)
    return verified, rejected


def run(run_id: str) -> None:
    rd = c.run_dir(run_id)
    records = c.read_jsonl(rd / "ingested.jsonl")
    c.banner("SKILL 1/3", "ledger-integrity-validator", "Ed25519 signatures · sha256 hash chain · replay / gap detection · registry from Snowflake")
    c.status_line({"INPUT": "done", "VALIDATE": "run", "DETECT": "todo", "SYNC+ATTEST": "todo"})

    c.section(f"Loading trust anchor  {c.LEDGER}.DEVICE_REGISTRY  +  RAW.SHIPMENTS manifest")
    conn = c.connect()
    registry, manifest = load_trust_anchor(conn)
    conn.close()
    for dev, reg in sorted(registry.items()):
        st = manifest.get(reg["shipment"], {}).get("status", "?")
        c.ok(f"{dev:<12} key {reg['pub'][:16]}…  genesis {reg['genesis'][:10]}…  -> {reg['shipment']} [{st}]")
        c.pause(0.15)

    c.section(f"Verifying {len(records)} readings against 7 ledger rules")
    total = len(records)
    step = max(1, total // 60)

    def tick(n):
        if n % step == 0 or n == total:
            c.progress("verify signatures", n, total)
            c.pause(0.07)

    verified, rejected = validate_records(records, registry, manifest, tick)

    c.section("Quarantined records")
    for x in rejected:
        c.bad(f"{c.RED}{x['rule']:<18}{c.RESET} {x['device_id']:<12} seq {x['seq']:>4}  {c.DIM}{x['detail']}{c.RESET}")
        c.pause(0.35)

    c.section("Rule summary")
    counts = Counter(x["rule"] for x in rejected)
    rows, colors = [], []
    for rule, text in RULE_TEXT.items():
        n = counts.get(rule, 0)
        rows.append([rule, text, n, "FAIL" if n else "pass"])
        colors.append([None, None, None, c.RED + c.BOLD if n else c.GREEN])
    c.table(["rule", "check", "records", "status"], rows, colors)

    c.write_jsonl(rd / "verified.jsonl", verified)
    c.write_jsonl(rd / "rejected.jsonl", rejected)
    pct = 100 * len(verified) / total
    c.out()
    c.ok(f"{c.BOLD}{len(verified)} verified{c.RESET} ({pct:.2f}%)   {c.RED}{c.BOLD}{len(rejected)} quarantined{c.RESET}   "
         f"chains intact for {len({v['device_id'] for v in verified})}/{len(registry)} registered loggers")
    c.status_line({"INPUT": "done", "VALIDATE": "done", "DETECT": "todo", "SYNC+ATTEST": "todo"})
