"""OUTCOME: read the signed attestation back from Snowflake and verify it independently.

Uses only what is stored in Snowflake (ATTESTATIONS row + VERIFIED_TELEMETRY + stage listing),
which is exactly what an auditor, insurer or retailer would have.
"""
from __future__ import annotations

import json

from . import common as c


def run(run_id: str) -> None:
    rd = c.run_dir(run_id)
    conn = c.connect()
    cur = conn.cursor()
    c.section(f"Auditor view  ·  {c.LEDGER}.ATTESTATIONS  ·  run {rd.name}")
    cur.execute(f"""SELECT ATTESTATION_ID, CREATED_TS, RECORDS_VERIFIED, RECORDS_REJECTED, ANOMALIES, MERKLE_ROOT,
                           REPORT_SHA256, SIGNER_PUBKEY, SIGNATURE, REPORT_FILE, REPORT
                    FROM {c.LEDGER}.ATTESTATIONS WHERE RUN_ID = %s""", (rd.name,))
    att_id, created, n_ok, n_bad, n_anom, root, digest, pub, sig, report_file, rep = cur.fetchone()
    rep = json.loads(rep) if isinstance(rep, str) else rep
    for k, v in (("attestation", att_id), ("issued", created.strftime("%Y-%m-%d %H:%M:%S")),
                 ("scope", f"{n_ok} verified · {n_bad} quarantined · {n_anom} anomalies"),
                 ("merkle root", root), ("report sha256", digest), ("signer", f"{rep['issuer']}  ed25519 {pub[:32]}…"),
                 ("signature", sig[:64] + "…"), ("report file", report_file)):
        c.out(f"    {c.CYAN}{k:<14}{c.RESET} {v}")
        c.pause(0.12)

    c.section("Independent checks (Snowflake data only)")
    recomputed = c.sha256_hex(c.canonical(rep))
    (c.ok if recomputed == digest else c.bad)(f"report sha256 recomputed from stored REPORT variant {'matches' if recomputed == digest else 'MISMATCH'}")
    c.pause(0.3)
    (c.ok if c.verify_sig(pub, sig, digest) else c.bad)("Ed25519 signature valid for attestor key")
    c.pause(0.3)
    cur.execute(f"SELECT ENTRY_HASH FROM {c.LEDGER}.VERIFIED_TELEMETRY WHERE RUN_ID = %s ORDER BY DEVICE_ID, SEQ", (rd.name,))
    remote = c.merkle_root([r[0] for r in cur.fetchall()])
    (c.ok if remote == root else c.bad)(f"Merkle root over {n_ok} ledger rows in Snowflake {'matches' if remote == root else 'MISMATCH'}")
    c.pause(0.3)
    cur.execute(f"LIST @{c.LEDGER}.ATTESTATION_STAGE/{rd.name}/")
    for name, size, *_ in cur.fetchall():
        c.ok(f"stage file  @{name.split('/', 1)[-1] if '/' in name else name}  ({int(size) / 1024:.1f} KiB)")
        c.pause(0.2)
    conn.close()

    c.section("Decision")
    rows = [[s["shipment_id"], s["verdict"], s["risk"], next((a["summary"] for a in rep["anomalies"] if a["shipment_id"] == s["shipment_id"]), "no anomaly")]
            for s in sorted(rep["shipments"], key=lambda s: -s["risk"])]
    c.table(["shipment", "verdict", "risk", "evidence"], rows, [[None, c.VERDICT_COLOR[r[1]], None, None] for r in rows])
