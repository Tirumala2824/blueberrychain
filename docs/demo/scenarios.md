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
| Customer (tier A) | **Summit Club Warehouse**, Salt Lake City DC | Requires **≥ 10 days** shelf life at receipt; on-time-in-full (OTIF) penalty 3% of line value |
| Customer (tier B) | **Bayline Markets**, Sacramento DC | Requires ≥ 5 days at receipt; pays ~95% of the contract price |
| Customer (tier C) | **Harbor Foodservice** (Oakland) | Requires ≥ 4 days |
| Processor | **Valley Fruit Processing** (Fresno) | Accepts ≥ 1 day; ~$3.50 / kg |

**Base prices (reference data, not code):** organic Emerald contract price **$11.20 / kg**.

## S-A: Reefer failure, clear winner (rule-decided, approval-gated)
- **Fault:** `reefer_compressor_failure` on RF-114 / TR-114. Starts 2 h into the 15 h haul from the packhouse to the Summit Club Salt Lake City DC; lasts 3.8 h; ambient 24 °C.
- **Load:** Lot **L-A** (4,200 kg organic Emerald), committed to a Summit Club order line.

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
  - `precool_delay` of 5 h at the packhouse, so the fruit loads warm;
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

## Running and resetting
- `bbc demo reset --seed <n>`: re-simulates the world from the seed. Nothing is restored from a snapshot of outcomes.
- `bbc demo run --scenario S-A|S-B|S-C [--fault-start …] [--duration …] [--ambient …]`.
- **Every number shown in the demo comes from the system.** The deck is updated from SQL after the final run.
