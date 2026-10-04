---
name: ledger-integrity-validator
description: Verify signed, hash-chained IoT cold-chain telemetry against BlueberryChain ledger rules (Ed25519, sha256 chain, replay, gaps) before anything trusts it.
tools:
- bash
- read
- snowflake_sql_execute
- sql_execute
---

# When to Use

- A reefer/logger gateway dump has been landed (`demo/out/runs/<RUN_ID>/ingested.jsonl`)
- Someone asks "can we trust this telemetry?", "was this data tampered with?", or "validate the ledger"
- Always before `$coldchain-anomaly-detector`: anomalies are only computed on verified data

# What This Skill Provides

Skill 1 of 3 in the BlueberryChain IoT ledger pipeline. Loads the trust anchor from Snowflake
(`BLUEBERRY_CHAIN.LEDGER.DEVICE_REGISTRY` public keys + genesis hashes, `RAW.SHIPMENTS` manifest)
and applies seven rules per reading, in arrival order, per device:

| rule | meaning |
|---|---|
| UNKNOWN_DEVICE | logger has no registered key |
| SHIPMENT_MISMATCH | shipment not bound to that logger/reefer, or not IN_TRANSIT |
| HASH_MISMATCH | payload edited after hashing |
| SIGNATURE_INVALID | re-hashed but not signed by the device key |
| REPLAY | sequence number re-sent |
| CHAIN_GAP | reading missing upstream |
| CHAIN_BREAK | prev_hash does not link to the prior entry |

# Instructions

1. Run `uv run demo/bbc.py skill run ledger-integrity-validator --run latest`
2. Report verified vs quarantined counts and every quarantined record with its rule.
3. Never "repair" a quarantined record. Quarantine is final; the record goes to
   `LEDGER.INTEGRITY_REJECTIONS` via `$snowflake-audit-sync`.
4. Outputs: `verified.jsonl`, `rejected.jsonl` in the run folder. Implementation: `demo/iot_ledger/validate.py`.
