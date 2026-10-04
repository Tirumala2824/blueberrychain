"""SKILL 3  snowflake-audit-sync

  1 sync verified ledger, quarantine and anomalies into BLUEBERRY_CHAIN.LEDGER (idempotent per RUN_ID)
  2 compute the Merkle root over every verified entry_hash (ordered by device, seq)
  3 build + Ed25519-sign the attestation report, export JSON + Markdown, PUT to @LEDGER.ATTESTATION_STAGE
  4 read back from Snowflake, re-derive the Merkle root, and prove it matches the signed attestation
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone

from . import common as c
from .anomaly import describe

ATTESTOR = "BBC-ATTESTOR-01"


def _ts(s: str) -> str:
    return s.replace("T", " ")


def _sync(conn, run_id, verified, rejected, anomalies, started) -> list[tuple[str, int, str]]:
    cur = conn.cursor()
    log = []
    for t in ("VERIFIED_TELEMETRY", "INTEGRITY_REJECTIONS", "ANOMALY_EVENTS", "ATTESTATIONS", "PIPELINE_RUNS"):
        cur.execute(f"DELETE FROM {c.LEDGER}.{t} WHERE RUN_ID = %s", (run_id,))

    rows = [(run_id, r["event_id"], r["device_id"], r["shipment_id"], r["seq"], _ts(r["ts"]), r["lat"], r["lon"],
             r["pulp_temp_c"], r["return_air_c"], r["door_open"], r["prev_hash"], r["entry_hash"], r["signature"])
            for r in verified]
    total, chunk = len(rows), 400
    for i in range(0, total, chunk):
        cur.executemany(f"""INSERT INTO {c.LEDGER}.VERIFIED_TELEMETRY
            (RUN_ID, EVENT_ID, DEVICE_ID, SHIPMENT_ID, SEQ, READING_TS, LAT, LON, PULP_TEMP_C, RETURN_AIR_C, DOOR_OPEN,
             PREV_HASH, ENTRY_HASH, SIGNATURE) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", rows[i:i + chunk])
        c.progress("VERIFIED_TELEMETRY", min(i + chunk, total), total, f"qid {cur.sfqid[:13]}…" if cur.sfqid else "")
        c.pause(0.3)
    log.append(("VERIFIED_TELEMETRY", total, cur.sfqid))

    def insert_variant(table, cols, vals, variant_idx):
        if not vals:
            return None
        width = len(cols)
        sel = ", ".join(f"PARSE_JSON(${i + 1})" if i == variant_idx else f"${i + 1}" for i in range(width))
        values = ", ".join("(" + ", ".join(["%s"] * width) + ")" for _ in vals)
        cur.execute(f"INSERT INTO {c.LEDGER}.{table} ({', '.join(cols)}) SELECT {sel} FROM VALUES {values}",
                    [x for v in vals for x in v])
        return cur.sfqid

    qid = insert_variant("INTEGRITY_REJECTIONS", ["RUN_ID", "EVENT_ID", "DEVICE_ID", "SHIPMENT_ID", "SEQ", "RULE", "DETAIL", "RAW_RECORD"],
                         [(run_id, x["event_id"], x["device_id"], x["shipment_id"], x["seq"], x["rule"], x["detail"], json.dumps(x["raw"]))
                          for x in rejected], 7)
    c.progress("INTEGRITY_REJECTIONS", len(rejected), len(rejected), f"qid {qid[:13]}…")
    c.pause(0.3)
    log.append(("INTEGRITY_REJECTIONS", len(rejected), qid))

    qid = insert_variant("ANOMALY_EVENTS", ["RUN_ID", "ANOMALY_ID", "SHIPMENT_ID", "DEVICE_ID", "ANOMALY_TYPE", "SEVERITY",
                                            "START_TS", "END_TS", "DURATION_MIN", "EVIDENCE"],
                         [(run_id, e["anomaly_id"], e["shipment_id"], e["device_id"], e["type"], e["severity"], _ts(e["start_ts"]),
                           _ts(e["end_ts"]), e["duration_min"], json.dumps(e["evidence"])) for e in anomalies], 9)
    c.progress("ANOMALY_EVENTS", len(anomalies), len(anomalies), f"qid {qid[:13]}…")
    c.pause(0.3)
    log.append(("ANOMALY_EVENTS", len(anomalies), qid))

    cur.execute(f"""INSERT INTO {c.LEDGER}.PIPELINE_RUNS (RUN_ID, STARTED_TS, SOURCE_FILES, RECORDS_IN, RECORDS_VERIFIED,
                    RECORDS_REJECTED, ANOMALIES, STATUS) VALUES (%s, %s, %s, %s, %s, %s, %s, 'SYNCED')""",
                (run_id, started, 7, len(verified) + len(rejected), len(verified), len(rejected), len(anomalies)))
    c.progress("PIPELINE_RUNS", 1, 1, f"qid {cur.sfqid[:13]}…")
    log.append(("PIPELINE_RUNS", 1, cur.sfqid))
    return log


def _report(run_id, verified, rejected, anomalies, summary, merkle, raw_files) -> dict:
    heads = {}
    for r in verified:
        if r["seq"] > heads.get(r["device_id"], {}).get("seq", 0):
            heads[r["device_id"]] = {"seq": r["seq"], "entry_hash": r["entry_hash"]}
    return {
        "attestation_id": f"ATT-{run_id}",
        "run_id": run_id,
        "issued_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "issuer": ATTESTOR,
        "scope": {"records_in": len(verified) + len(rejected), "records_verified": len(verified),
                  "records_quarantined": len(rejected), "anomalies": len(anomalies),
                  "shipments": len(summary), "loggers": len(heads)},
        "ledger": {"hash": "sha256(canonical payload incl. prev_hash)", "signature": "Ed25519 per reading",
                   "merkle_root": merkle, "chain_heads": heads},
        "integrity_rules": dict(Counter(x["rule"] for x in rejected)),
        "source_files_sha256": raw_files,
        "shipments": summary,
        "anomalies": [{"id": e["anomaly_id"], "shipment_id": e["shipment_id"], "type": e["type"], "severity": e["severity"],
                       "window": f"{e['start_ts']}/{e['end_ts']}", "summary": describe(e)} for e in anomalies],
        "snowflake_targets": [f"{c.LEDGER}.{t}" for t in ("VERIFIED_TELEMETRY", "INTEGRITY_REJECTIONS", "ANOMALY_EVENTS",
                                                         "ATTESTATIONS", "PIPELINE_RUNS")],
    }


def _markdown(rep: dict, sig: str, pub: str, digest: str) -> str:
    s = rep["scope"]
    lines = [f"# Cold-chain attestation {rep['attestation_id']}", "",
             f"Issued {rep['issued_utc']} by `{rep['issuer']}` for BlueberryChain run `{rep['run_id']}`.", "",
             "## Scope", "",
             f"| records in | verified | quarantined | anomalies | shipments | loggers |", "|---|---|---|---|---|---|",
             f"| {s['records_in']} | {s['records_verified']} | {s['records_quarantined']} | {s['anomalies']} | {s['shipments']} | {s['loggers']} |", "",
             "## Shipment verdicts", "", "| shipment | verified readings | anomalies | risk | verdict |", "|---|---|---|---|---|"]
    lines += [f"| {x['shipment_id']} | {x['readings']} | {x['anomalies']} | {x['risk']} | **{x['verdict']}** |" for x in rep["shipments"]]
    lines += ["", "## Anomalies", "", "| id | shipment | type | severity | detail |", "|---|---|---|---|---|"]
    lines += [f"| {a['id']} | {a['shipment_id']} | {a['type']} | {a['severity']} | {a['summary']} |" for a in rep["anomalies"]]
    lines += ["", "## Integrity", "", "| rule | quarantined |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in rep["integrity_rules"].items()]
    lines += ["", "## Proof", "", f"- Merkle root (verified entry hashes): `{rep['ledger']['merkle_root']}`",
              f"- Report sha256: `{digest}`", f"- Attestor public key (Ed25519): `{pub}`", f"- Signature: `{sig}`", "",
              "Verify: recompute sha256 over the canonical JSON report, then Ed25519-verify the signature with the public key."]
    return "\n".join(lines) + "\n"


def run(run_id: str) -> None:
    rd = c.run_dir(run_id)
    verified = c.read_jsonl(rd / "verified.jsonl")
    rejected = c.read_jsonl(rd / "rejected.jsonl")
    det = json.loads((rd / "anomalies.json").read_text())
    anomalies, summary = det["events"], det["summary"]
    started = datetime.fromtimestamp((rd / "ingested.jsonl").stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")

    c.banner("SKILL 3/3", "snowflake-audit-sync", f"verified ledger -> {c.LEDGER}  ·  Merkle root  ·  signed attestation -> @ATTESTATION_STAGE")
    c.status_line({"INPUT": "done", "VALIDATE": "done", "DETECT": "done", "SYNC+ATTEST": "run"})

    c.section(f"Syncing run {rd.name} into Snowflake  (account {c.CONNECTION}, warehouse BBC_WH)")
    conn = c.connect()
    log = _sync(conn, rd.name, verified, rejected, anomalies, started)

    c.section("Sealing the ledger")
    ordered = sorted(verified, key=lambda r: (r["device_id"], r["seq"]))
    merkle = c.merkle_root([r["entry_hash"] for r in ordered])
    c.ok(f"Merkle root over {len(ordered)} verified entries  {c.BOLD}{c.CYAN}{merkle}{c.RESET}")
    c.pause(0.4)
    raw_files = {p.name: c.sha256_hex(p.read_bytes()) for p in sorted((rd / "raw").glob("*.jsonl"))}
    rep = _report(rd.name, verified, rejected, anomalies, summary, merkle, raw_files)
    digest = c.sha256_hex(c.canonical(rep))
    key = c.device_key(ATTESTOR)
    pub, sig = c.pubkey_hex(key), key.sign(bytes.fromhex(digest)).hex()
    c.ok(f"report sha256 {digest[:32]}…  signed Ed25519 by {ATTESTOR}")
    c.pause(0.4)

    json_path = rd / f"attestation_{rd.name}.json"
    md_path = rd / f"attestation_{rd.name}.md"
    json_path.write_text(json.dumps({"report": rep, "report_sha256": digest, "signer_pubkey": pub, "signature": sig}, indent=2))
    md_path.write_text(_markdown(rep, sig, pub, digest), encoding="utf-8")
    cur = conn.cursor()
    for p in (json_path, md_path):
        cur.execute(f"PUT 'file://{p.as_posix()}' @{c.LEDGER}.ATTESTATION_STAGE/{rd.name}/ AUTO_COMPRESS = FALSE OVERWRITE = TRUE")
        c.ok(f"exported {p.name:<34} -> @LEDGER.ATTESTATION_STAGE/{rd.name}/  ({p.stat().st_size / 1024:.1f} KiB)")
        c.pause(0.3)
    cur.execute(f"""INSERT INTO {c.LEDGER}.ATTESTATIONS (RUN_ID, ATTESTATION_ID, RECORDS_VERIFIED, RECORDS_REJECTED, ANOMALIES,
                    MERKLE_ROOT, REPORT_SHA256, SIGNER_PUBKEY, SIGNATURE, REPORT_FILE, REPORT)
                    SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, PARSE_JSON(%s)""",
                (rd.name, rep["attestation_id"], len(verified), len(rejected), len(anomalies), merkle, digest, pub, sig,
                 f"@LEDGER.ATTESTATION_STAGE/{rd.name}/{md_path.name}", json.dumps(rep)))
    log.append(("ATTESTATIONS", 1, cur.sfqid))
    cur.execute(f"UPDATE {c.LEDGER}.PIPELINE_RUNS SET STATUS = 'ATTESTED' WHERE RUN_ID = %s", (rd.name,))

    c.section("Read-back verification from Snowflake")
    cur.execute(f"SELECT ENTRY_HASH FROM {c.LEDGER}.VERIFIED_TELEMETRY WHERE RUN_ID = %s ORDER BY DEVICE_ID, SEQ", (rd.name,))
    remote = c.merkle_root([r[0] for r in cur.fetchall()])
    cur.execute(f"SELECT MERKLE_ROOT, SIGNER_PUBKEY, SIGNATURE, REPORT_SHA256 FROM {c.LEDGER}.ATTESTATIONS WHERE RUN_ID = %s", (rd.name,))
    m_root, m_pub, m_sig, m_digest = cur.fetchone()
    match = remote == m_root == merkle
    (c.ok if match else c.bad)(f"Merkle root re-derived from Snowflake rows {'matches' if match else 'DOES NOT match'} attestation  {remote[:24]}…")
    sig_ok = c.verify_sig(m_pub, m_sig, m_digest)
    (c.ok if sig_ok else c.bad)(f"attestation signature verifies with stored public key {m_pub[:16]}…")
    c.pause(0.4)
    c.table(["Snowflake table", "rows", "query id"], [[t, n, q or "-"] for t, n, q in log])

    c.section(f"{c.LEDGER}.V_SHIPMENT_TRUST")
    cur.execute(f"""SELECT SHIPMENT_ID, LOT_ID, SHIPPED_KG, VERIFIED_READINGS, REJECTED_READINGS, ANOMALIES, RISK_SCORE, VERDICT
                    FROM {c.LEDGER}.V_SHIPMENT_TRUST WHERE RUN_ID = %s ORDER BY RISK_SCORE DESC, SHIPMENT_ID""", (rd.name,))
    trust = cur.fetchall()
    conn.close()
    c.table(["shipment", "lot", "kg", "verified", "quarantined", "anomalies", "risk", "verdict"],
            [[r[0], r[1], f"{float(r[2]):,.0f}", int(r[3]), int(r[4]), int(r[5]), int(r[6]), r[7]] for r in trust],
            [[None] * 7 + [c.VERDICT_COLOR[r[7]]] for r in trust])
    held_kg = sum(float(r[2]) for r in trust if r[7] == "HOLD")
    c.out()
    c.ok(f"{c.BOLD}Run {rd.name} ATTESTED{c.RESET}   {len(verified)} ledger rows · {len(rejected)} quarantined · {len(anomalies)} anomalies · "
         f"{c.RED}{c.BOLD}{held_kg:,.0f} kg on HOLD{c.RESET}")
    c.status_line({"INPUT": "done", "VALIDATE": "done", "DETECT": "done", "SYNC+ATTEST": "done"})
