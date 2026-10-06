# Demo scenario catalog

**Plan task:** 1.7.

**A scenario fixes the *fault*, never the *outcome*.**
- Each scenario names a world state and a fault to inject.
- Everything after that is computed live by the system: detection, the options and their values, which path is taken (rule or agent), the approvals required, the actions and the proof.
- The "expected path" columns describe what the design *should* produce. If the system does something else, that's a finding to investigate, not something to script around.
- Judges may change the fault parameters.

## The world (fictional companies; real place names and blueberry varieties)
| Role | Name | Key facts |
|---|---|---|
| Grower / packhouse | **Emerald Ridge Farms**, Ranch 14 Block 7 + Emerald Ridge Packhouse (Kingsburg, CA) | Organic Emerald and Duke; forced-air pre-cooling |
| Grower | **Valley Crest Growers** (Visalia, CA) | Supplies replacement stock |
| Carrier | **Sierra Reefer Lines**: truck TR-114, reefer unit RF-114 | Carrier contract: liable for excursions in its custody when the BOL states the setpoint; liability cap $50k per load; claims ≥ $500 |
| Carrier | **Coastline Cold Freight** | Alternative carrier for re-routes |
| Own DC | **Central Valley DC** (Tracy, CA) | Holds quality-adjusted replacement stock |
| Customer (tier A) | **Summit Club Warehouse**, Salt Lake City DC | Requires **≥ 10 days** shelf life at receipt and pulp **≤ 2.0 °C**; on-time-in-full (OTIF) penalty 3% of line value |
| Customer (tier B) | **Bayline Markets**, Sacramento DC | Requires ≥ 5 days at receipt and pulp ≤ 4.4 °C (40 °F); pays ~95% of the contract price |
| Customer (tier C) | **Harbor Foodservice** (Oakland) | Requires ≥ 4 days and pulp ≤ 5.0 °C (41 °F) |
| Processor | **Valley Fruit Processing** (Fresno) | Accepts ≥ 1 day; ~$3.50 / kg |

**Base prices (reference data, not code):** organic Emerald contract price **$11.20 / kg**.

## S-A: Reefer failure, clear winner (rule-decided, approval-gated)
- **Fault:** `reefer_compressor_failure` on RF-114 / TR-114. Starts 30 min into the 15 h haul from the packhouse to the Summit Club Salt Lake City DC; lasts 3.8 h; ambient 24 °C.
  - *Why 30 min:* in the simulator a loaded trailer's fruit takes about 40 min to cross 1.8 °C after the compressor stops, and the re-route window closes at the I-80 junction, 3 h into the haul. A start at 2 h would leave no time to decide.
- **Load:** Lot **L-A** (4,200 kg organic Emerald), held 5 days in the packhouse cooler, then committed to a Summit Club order line.

| Stage | Expected path (design intent, not scripted) |
|---|---|
| Detection | The case opens within ~2 minutes of the breach accumulating. The custody holder at onset is the carrier |
| Understanding | Remaining shelf life drops below what Summit needs at ETA. The excess loss falls mostly in the carrier segment. No evidence conflict, so **no Forensics agent** |
| Options / evaluation | Do nothing (rejected at receipt) vs re-route to Bayline vs downgrade to the processor vs inspect. Expedite to Summit is **eliminated: SPEC_INFEASIBLE** |
| Recommendation | Re-route to Bayline + refill the Summit line from Central Valley DC stock **clearly wins**, so it's **rule-decided, no LLM** |
| Governance / approval | The re-route is above $25k, so **Sales manager approval** is needed (as `BBC_DEMO_SALES`). A claim notice to Sierra goes out automatically (L3) |
| Execution | TMS re-route, SAP sales-order change + replacement allocation, carrier claim notice; before / after states recorded |
| Outcome / audit | Receipt QC at Bayline → actual vs predicted shelf life; ledger verify; tamper-on-clone; replay |

**What it demonstrates:** detection without a prompt; option economics against "do nothing"; *no AI when it isn't needed*; approval as a real identity; proof.

## S-B: Conflicting evidence, near-tie, tier-A customer (agent-escalated)
- **Faults:**
  - `precool_delay` of 5 h after a hot-afternoon harvest (30 °C), followed by a rushed 1 h pre-cool, so the fruit loads warm;
  - `paperwork_inconsistent`: the inspection certificate claims pulp at **1.0 °C at 06:40**, while the pulp probe reads ~4 °C;
  - `door_open_dwell` of 40 min at the Central Valley DC dock.
- **Load:** Lot **L-B** (3,600 kg organic Duke) for a Summit Club line. The shelf-life margin at ETA is close to the 10-day spec.

| Stage | Expected path |
|---|---|
| Understanding | `EVIDENCE_CONFLICT` (certificate vs probe) and `CAUSE_AMBIGUOUS` (exposure split across grower and DC) → **Excursion Forensics** agent. It should find **grower pre-cooling** responsible, not the carrier |
| Options / evaluation | Continue (risky) vs inspect at the DC vs re-route to Harbor Foodservice: near-tie on the risk-adjusted score, tier-A customer affected → **Recovery Strategist** agent |
| Governance | The AI recommendation goes through the **Evidence Integrity Auditor**. Approvals: Quality (inventory / risk) + Sales (tier-A) |
| Execution / outcome / audit | As in S-A. The claim position shifts to a **grower deduction** rather than a carrier claim |

**What it demonstrates:** AI used only where judgment is needed; documents checked against sensor truth; liability follows evidence; auditor gating; two approvers.

## S-C: Carrier claim with a defense (D2 settlement)
- **Follows** S-A once its outcome is recorded.
- **Counterparty behavior** (rule-based in mock-tms): Sierra Reefer Lines answers the claim with the defense **"shipper loaded warm product"**.

| Stage | Expected path |
|---|---|
| D2 options | File the claim for the residual loss (from the calculator variants) vs absorb |
| Claims & Recovery agent | Tests the defense with `ANALYZE_CAUSAL_SIGNATURES`: pulp at loading ≈ 0.8 °C, setpoint on the BOL 0.5 °C, so the defense doesn't hold → drafts a rebuttal |
| Counterparty | Partial offer; the settlement must fall inside the policy band |
| Governance | Finance approval (as `BBC_DEMO_FINANCE`) |
| Audit | Case sealed; decision record committed to memory |

**What it demonstrates:** recovering money as well as saving fruit; argument grounded in evidence; amounts that always come from the calculator.

## Engine findings (Day 5)
How each scenario was run:
1. Simulate the scenario.
2. Open the case where `DECISION.OPEN_CASES` would. The rule (`bbc_toolkit.cases`) is: more than the product tolerance (30 min) of counted breach minutes above 1.8 °C in the trailing 60-minute window, plus about 2 minutes of detection lag.
   - The Python reference is `blueberrychain.sim.assess.detect`.
   - `snowflake/spikes/wp6a_detection_dryrun.py` runs the procedure's SQL in Snowflake over the same trips and matches it at every cut-off.
3. Seal the pack from front-door data only (`blueberrychain.sim.assess`).
4. Evaluate with `bbc_engine`.

Pinned by `python/blueberrychain/tests/test_assess.py`. These results are what the engine computed. Where they differ from the expected paths above, the expected paths stay as design intent and the difference is recorded here.

### S-A (defaults: 3.8 h fault from 30 min, 24 °C ambient)
- **Detection.**
  - The breach run starts at 11:25 in Sierra's custody.
  - The rule holds at 11:50: 35 breach minutes in the window, including an isolated 1.81 °C reading at 11:05. A window count, unlike a consecutive-run count, keeps such readings.
  - The case opens at about 11:52, 1.87 h after departure and about 70 minutes before the junction closes the re-route window.
  - All attributable excess belongs to Sierra.
- **Understanding (differs from the design).**
  - Five days in the packhouse cooler left **15.1 days** of shelf life, against Summit's 10-day spec, so shelf life is not what threatens the order.
  - The threat is Summit's **2.0 °C arrival limit**. At decision time the compressor is still failing, and the fault may persist for 0.5–4 h (prior 0.7).
  - Doing nothing is therefore a gamble: P(accept) 0.66, E[NRV] $40.3k.
- **Recommendation (differs from the design): NEAR_TIE → Recovery Strategist, not a rule.**

  | Option | Risk-adjusted score | Why |
  |---|---|---|
  | Inspect at Central Valley DC (refill Summit from DC stock) | $45,204 | Unloads the fruit within 1.5 h; costs inspection, handling and a waiting truck |
  | Re-route to Bayline (refill Summit from DC stock) | $44,978 | About 2% rejection risk on Bayline's 4.4 °C limit while the fault is active |

  - The margin is $226, against a threshold of $1,356. Neither option dominates the other, so this is a genuine judgment call.
  - Expedite is SPEC_INFEASIBLE.

### S-A fault-parameter variants (judge-chosen)
| Fault parameters | Case opens | Engine result |
|---|---|---|
| Duration 1.2 h | 1.87 h | **Rule: do nothing.** The fruit recovers before arrival ($47,040; P(accept) 1.00) |
| Ambient 30 °C | 1.78 h | **Rule: inspect at the DC.** Harbor is SPEC_INFEASIBLE and Bayline's P(accept) drops to 0.84; margin $3.85k |
| Ambient 35 °C | 1.70 h | **Rule: inspect at the DC.** Every re-route is SPEC_INFEASIBLE |
| Ambient 15–18 °C | 2.12 h | **Rule: re-route to Bayline + refill Summit from DC stock** ($45,611; P(accept) 1.00). This is the design's expected path: a mild fault leaves Bayline safe, and inspecting is dominated |
| Ambient 12 °C | 2.37 h | The mildest fault is detected last, leaving 38 min to the junction. Dispatch lead (15 min) plus approval buffer (30 min) makes **every diversion WINDOW_CLOSED**. The best remaining option is "continue and inspect on arrival" ($45,227 vs $44,401 for doing nothing), which escalates as STRATEGIC_CUSTOMER |

The 12 °C row is the case for pre-authorizing re-routes: the approval buffer alone closes the window. It is a policy question (autonomy thresholds), not an engine one.

### S-B (defaults)
- **Detection.**
  - The fruit loaded warm: pulp never fell below 6.2 °C at the packhouse.
  - The grower's own readings don't count before the cold chain starts, so the breach run starts at the 10:05 reading, the first in Coastline's custody.
  - The case opens at about 10:37, 0.62 h after departure.
  - **99% of the attributable excess belongs to the grower**, Emerald Ridge, so no carrier claim notice is attached.
- **Recommendation.** It escalates on `MODEL_OUT_OF_RANGE` (in the 30 °C field the pulp passed the shelf-life model's 20 °C validity limit) and `STRATEGIC_CUSTOMER`.
  - The top option is to inspect at the DC and short the Summit line, because there is no organic Duke replacement stock.
  - Re-routing to Harbor is close behind, but inspection dominates it.
- **Until Day 9.** `EVIDENCE_CONFLICT` and `CAUSE_AMBIGUOUS` need the certificate and the incident note, so the Excursion Forensics path waits for the document pipeline.
- **Known limit of the v1 detection rule.** A lot that leaves pre-cooling warm is caught only once a carrier holds it. Catching it at the packhouse would need a pre-shipment option set (hold the load), which v1 doesn't generate.

## Running and resetting
- `bbc demo reset --seed <n>`: re-simulates the world from the seed. Nothing is restored from a snapshot of outcomes.
- `bbc demo run --scenario S-A|S-B|S-C [--fault-start …] [--duration …] [--ambient …]`.
- **Every number shown in the demo comes from the system.** The deck is updated from SQL after the final run.
