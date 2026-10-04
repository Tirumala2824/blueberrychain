---
name: coldchain-anomaly-detector
description: Detect cold-chain anomalies (temperature excursions, door-open, GPS spoofing, stuck sensors, outliers) on verified telemetry and give each shipment a HOLD / INSPECT / RELEASE verdict.
tools:
- bash
- read
---

# When to Use

- After `$ledger-integrity-validator` has produced `verified.jsonl` for a run
- Questions like "which loads broke the cold chain?", "is this shipment safe to release?"

# What This Skill Provides

Skill 2 of 3. Runs only on verified readings, so quarantined data can neither raise nor hide an alarm.

| detector | rule |
|---|---|
| TEMP_EXCURSION | pulp temp > 1.8 C (same limit as TEMPERATURE_COMPLIANCE_PCT in the semantic view), runs >= 10 min |
| DOOR_OPEN | door flag >= 10 min (HIGH at >= 20 min) |
| GPS_JUMP | implied speed between fixes > 130 km/h |
| SENSOR_FLATLINE | identical probe value >= 60 min |
| STAT_OUTLIER | return-air robust z-score (median/MAD) > 6 outside door/excursion windows |

Risk = CRITICAL 60 + HIGH 30 + WARN 15 + INFO 5, capped at 100. HOLD >= 60, INSPECT >= 25, else RELEASE.
The same scale is implemented in SQL by `BLUEBERRY_CHAIN.LEDGER.V_SHIPMENT_TRUST`.

# Instructions

1. Run `uv run demo/bbc.py skill run coldchain-anomaly-detector --run latest`
2. Lead with HOLD shipments and the evidence (hours above limit, peak, degree-minutes).
3. Output: `anomalies.json` in the run folder. Implementation: `demo/iot_ledger/anomaly.py`.
