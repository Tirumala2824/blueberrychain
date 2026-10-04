---
name: snowflake-audit-sync
description: Sync the verified ledger, quarantine and anomalies into BLUEBERRY_CHAIN.LEDGER, seal it with a Merkle root, and export a signed attestation report to a Snowflake stage.
tools:
- bash
- read
- snowflake_sql_execute
- sql_execute
---

# When to Use

- After `$coldchain-anomaly-detector` for a run
- "Publish the audit trail", "give me an attestation for last night's loads", "sync to Snowflake"

# What This Skill Provides

Skill 3 of 3. Writes, idempotently per RUN_ID:

- `LEDGER.VERIFIED_TELEMETRY`, `LEDGER.INTEGRITY_REJECTIONS`, `LEDGER.ANOMALY_EVENTS`, `LEDGER.PIPELINE_RUNS`
- `LEDGER.ATTESTATIONS` with Merkle root, report sha256, Ed25519 signature and the full report as VARIANT
- `@LEDGER.ATTESTATION_STAGE/<RUN_ID>/attestation_<RUN_ID>.{json,md}`

Then proves the round trip: re-reads every ENTRY_HASH from Snowflake, re-derives the Merkle root, and
verifies the stored signature. Finishes with `LEDGER.V_SHIPMENT_TRUST` (verdict per shipment and lot).

# Instructions

1. Run `uv run demo/bbc.py skill run snowflake-audit-sync --run latest`
2. Report the Merkle root, whether the read-back matched, and the HOLD kilograms.
3. Never claim "attested" if the read-back Merkle root or signature check prints ✖.
4. DDL: `sql/11_iot_ledger.sql`. Implementation: `demo/iot_ledger/sync.py`.
