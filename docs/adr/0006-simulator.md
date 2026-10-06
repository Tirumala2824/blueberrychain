# ADR-0006: Physics-based world simulator

- **Status:** Accepted
- **Date:** 2026-10-06
- **Depends on:** plan tasks 2.4, 3.3, 4.3, 8.1, 9.1, 13.1

## Context
- Real growers, reefers and retailers aren't available.
- The demo must still be **unscripted**: a judge picks a fault, and the outcome emerges from the system's models.
- Outcome tracking only means something if "reality" can differ from the system's estimates.

## Decision
- **Package:** `python/blueberrychain/sim`, driven by `bbc sim …`.
- **World:**
  - defined in `world.yaml` with **fictional** companies: ranches / blocks, packhouse, carriers and reefers, the company's own DC, customer DCs with their specs, a processor, lanes, contracts, prices and cost rates;
  - `bbc sim init` writes the reference CSVs loaded through `API.APPLY_REFERENCE_CHANGE`.
- **Ground truth differs from the estimator:**
  - each lot draws its own true reference shelf life and Q10 around the product parameters;
  - pulp temperature follows a lumped thermal model driven by reefer air, door events and ambient conditions.
  
  `bbc_engine` estimates from sensors; the simulator knows the truth. This is what makes `SL_PREDICTION_ERROR` real.
- **Faults:** reefer compressor failure, defrost stuck, setpoint error vs the BOL, door-open dwell, pre-cooling delay, probe misplacement or dropout, late truck, and inconsistent paperwork.
  - Each fault has parameters (start, duration, severity), so judges can choose them.
- **Everything goes through the front door:**
  - telemetry → IoT webhook;
  - orders, stock and QC → mock-s4;
  - shipments, custody and claims → mock-tms;
  - documents → the files connector (PDFs from `sim/pdf.py`).
  
  The simulator **never inserts into Snowflake tables directly**.
- **Clock and modes:**
  - an accelerated clock (default 60×);
  - **live** and **backfill** modes (30 days of history driven through the real pipeline, `provenance = SIMULATION_BACKFILL`).
- **Deterministic:** the same seed gives the same world and the same faults. `bbc demo reset` re-simulates from a seed. **Nothing in the outcome is pinned.**

## Consequences
- **The physics needs care:** a test compares the DT physics with `bbc_engine.physics` (task 3.6), and the simulator's thermal model is validated against plausible cooling and warming rates.
- **Pipeline speed:** backfill speed is limited by how fast the pipeline runs; 30 days at an accelerated clock is sized on Day 13.

## Alternatives considered
- **Static seed data:** rejected. It's the baseline's "pinned demo" problem, and it can't exercise detection, freshness or outcomes.
- **Replaying a public dataset:** rejected. No public dataset combines telemetry, custody, orders and contracts.
