/**
 * Tape S-B (docs/demo/scenarios.md): conflicting evidence. A pre-cool delay at the
 * packhouse warms lot L-B; the inspection certificate claims 1.0 C while the primary
 * probe reads 4.2 C. EVIDENCE_CONFLICT escalates to Excursion Forensics; a near-tie on a
 * tier-A line escalates to the Recovery Strategist; the Evidence Integrity Auditor (a
 * different model family) checks the AI-written narrative. Quality (DR-08: AI-chosen D1
 * above $10k) and Sales (DR-05: tier-A commitment change) must both approve.
 */

import { canonicalHash } from "@blueberrychain/shared";
import {
  ENGINE_USER,
  LedgerChain,
  PERSONA_IDS,
  TASK_USER,
  advanceMutation,
  at,
  baseView,
  clone,
  curve,
  fakeHash,
  fixture,
  frame,
  mutation,
  proofResponses,
  thermal,
  transition,
  type CaseView,
  type Option,
  type Tape,
  type TapeFrame,
  type TapeResponse,
} from "./kit.js";

export const SB_CASE = "CASE-00000023";
const PACK = "PACK-00000040";
const SHIPMENT = "SHP-20261006-131";
const FIND = "FND-00000031";
const REC = "REC-00000052";
const EVAL = "EVAL-00000058";
const APR_QUALITY = "APR-00000070";
const APR_SALES = "APR-00000071";
const PLAN = "PLAN-00000015";
const RUN_F = "RUN-00000210";
const RUN_S = "RUN-00000211";
const RUN_A = "RUN-00000212";
const DEADLINE = at("10:20:00");
const CLAUDE = "claude-sonnet-4-5";
const AUDITOR_MODEL = "mistral-large2";

type Pack = NonNullable<CaseView["analysis"]["pack"]>;
type Brief = NonNullable<CaseView["decision"]["recommendations"][number]["brief"]>;
type Run = CaseView["agents"]["runs"][number];
type TraceEvent = Run["trace"][number];
type Step = { delay_ms: number; event: TraceEvent };

function pack(): Pack {
  const p = fixture<Pack>("evidence_pack");
  p.pack_id = PACK;
  p.case_id = SB_CASE;
  p.as_of = at("07:00:30");
  p.sealed_at = at("07:00:41");
  p.content_hash = fakeHash("pack-S-B-1");
  p.shipment = {
    ...p.shipment, shipment_id: SHIPMENT, reefer_device_id: "RF-131", eta_p50_at: at("05:30:00", "2026-10-07"),
    eta_p90_at: at("07:00:00", "2026-10-07"),
    reefer_state: { as_of: at("06:58:00"), mode: "CONTINUOUS", alarms: [], supply_air_c: 0.6, return_air_c: 2.9, setpoint_c: 0.5 },
    evidence_id: `EV:PACK:${PACK}#/shipment`,
  };
  const lot = p.lots[0]!;
  Object.assign(lot, {
    lot_id: "L-B", product_id: "BB-DUKE-ORG-12x6", kg: 3600, planned_value_usd: 40320.0, harvest_at: at("23:30:00", "2026-10-05"),
    primary_probe_device_id: "P-B1", last_pulp_c: 4.2, last_reading_at: at("06:59:00"), model_validity: "EXTRAPOLATING", sigma_days: 1.4,
  });
  lot.values = [
    { name: "REMAINING_SHELF_LIFE_DAYS", value: 10.6, unit: "days", grain: "lot", as_of: at("06:59:00"), data_age_min: 1, freshness: "OK", metric_version: "1", evidence_id: `EV:PACK:${PACK}#/lots/0/values/0` },
    { name: "MONITORING_COVERAGE_PCT", value: 98.0, unit: "%", grain: "lot", as_of: at("06:59:00"), data_age_min: 1, freshness: "OK", metric_version: "1", evidence_id: `EV:PACK:${PACK}#/lots/0/values/1` },
    { name: "VALUE_AT_RISK_USD", value: 18144.0, unit: "USD", grain: "case_lot", as_of: at("07:00:30"), data_age_min: 0, freshness: "OK", metric_version: "1", evidence_id: `EV:PACK:${PACK}#/lots/0/values/2` },
  ];
  lot.custody_exposure = [
    { holder_party_id: "PARTY-EMERALD-RIDGE", holder_type: "PACKHOUSE", excess_life_share: 0.99, thermal_exposure_deg_h: 11.6, breach_min: 300, evidence_id: `EV:PACK:${PACK}#/lots/0/custody_exposure/0` },
    { holder_party_id: "PARTY-SIERRA", holder_type: "CARRIER", excess_life_share: 0.01, thermal_exposure_deg_h: 0.2, breach_min: 40, evidence_id: `EV:PACK:${PACK}#/lots/0/custody_exposure/1` },
  ];
  p.custody_timeline = [
    { party_id: "PARTY-EMERALD-RIDGE", holder_type: "PACKHOUSE", site_id: "SITE-EMERALD-PACK", from_at: at("23:30:00", "2026-10-05"), to_at: at("06:20:00"), evidence_id: `EV:PACK:${PACK}#/custody_timeline/0` },
    { party_id: "PARTY-SIERRA", holder_type: "CARRIER", site_id: null, from_at: at("06:20:00"), to_at: null, evidence_id: `EV:PACK:${PACK}#/custody_timeline/1` },
  ];
  p.affected_order_lines = [{ ...p.affected_order_lines[0]!, order_line_id: "SO-6002-10", kg: 3600, assigned_lot_id: "L-B", evidence_id: `EV:PACK:${PACK}#/affected_order_lines/0` }];
  p.candidate_inventory = [{ ...p.candidate_inventory[0]!, evidence_id: `EV:PACK:${PACK}#/candidate_inventory/0` }];
  p.candidate_destinations = [
    { site_id: "SITE-HARBOR-OAK", party_id: "PARTY-HARBOR", channel: "FOODSERVICE", customer_tier: "B", price_usd_per_kg: 8.9, transit_h_p50: 2.5, transit_h_p90: 3.5, min_shelf_life_days_at_receipt: 4, capacity_kg: 6000, max_arrival_pulp_c: 5.0, freight_usd: 700.0, evidence_id: `EV:PACK:${PACK}#/candidate_destinations/0` },
  ];
  p.inspection_sites = [{ ...p.inspection_sites![0]!, evidence_id: `EV:PACK:${PACK}#/inspection_sites/0` }];
  p.documents = [{
    doc_id: "DOC-SFI-044813", doc_type: "INSPECTION_CERT", sha256: fakeHash("doc-SFI-044813"), received_at: at("06:45:00"),
    claims: [
      { claim_key: "pulp_temp_at_loading_c", value: 1.0, unit: "C", claimed_at: at("06:40:00"),
        consistency: { verdict: "CONFLICT", sensor_value: 4.2, delta: 3.2, rule_id: "TEMP_AT_TIME@1" }, evidence_id: "EV:DOC:DOC-SFI-044813#pulp_temp_at_loading_c" },
      { claim_key: "inspection_at", value: "2026-10-06T06:40:00Z", unit: null, claimed_at: at("06:40:00"),
        consistency: { verdict: "UNVERIFIABLE", sensor_value: null, delta: null, rule_id: "TIME_AT_SITE@1" }, evidence_id: "EV:DOC:DOC-SFI-044813#inspection_at" },
    ],
  }] as Pack["documents"];
  p.deadline_inputs = { windows: [{ kind: "REROUTE", site_id: "SITE-JCT-I5-STK", closes_at: at("10:50:00") }] };
  return p;
}

function options(): Option[] {
  const base = fixture<Option>("option", 0);
  const mk = (id: string, label: string, patch: Partial<Option>, fin: Record<string, number>, op: Record<string, number>, rank: number, ra: number, extra: Partial<Option["outcome"]> = {}): Option => {
    const o = clone(base);
    Object.assign(o, { option_id: id, case_id: SB_CASE, label, evidence_id: `EV:OPT:${id}`, is_default: false, is_fallback: false, flags: ["MODEL_EXTRAPOLATING"], ...patch });
    o.provenance = { ...o.provenance, pack_id: PACK, seed: 520000 + Number(id.slice(-3)), inputs_hash: fakeHash("inputs-S-B") };
    o.outcome = {
      ...o.outcome,
      operational: { p_accept: op["p_accept"]!, sl_at_arrival_days_p50: op["sl"]!, kg_delivered_expected: op["kg"]! },
      financial: {
        expected_revenue_usd: fin["rev"]!, costs: { freight_delta_usd: fin["freight"] ?? 0, inspection_usd: fin["insp"] ?? 0 },
        expected_penalties_usd: fin["pen"] ?? 0, expected_recovery_usd: fin["rec"] ?? 0, expected_nrv_usd: fin["nrv"]!,
        nrv_p10_usd: fin["p10"]!, nrv_p90_usd: fin["p90"]!, expected_loss_usd: 40320 - fin["nrv"]!, value_preserved_vs_default_usd: fin["nrv"]! - 33900,
      },
      risk: { p_reject: 1 - op["p_accept"]!, food_safety_flag: false, evidence_risk: "HIGH" },
      customer: { lines_affected: 1, tier_a_shortfall_kg: op["short"] ?? 0 },
      logistics: {}, inventory: {}, recovery_cost_usd: (fin["freight"] ?? 0) + (fin["insp"] ?? 0),
      confidence: { level: "MEDIUM", drivers: ["model EXTRAPOLATING (pulp above the calibrated range)", "certificate contradicts the probe"] },
      ...extra,
    };
    o.score = { risk_adjusted_usd: ra, rank, dominated_by: [], objective_version: "objective@1" };
    return o;
  };
  return [
    mk("OPT-00000141", "Do nothing: continue L-B to Summit Club Salt Lake City DC", { is_default: true, expires_at: at("08:00:00", "2026-10-07"),
      bundle: { lots: [{ lot_id: "L-B", disposition: "CONTINUE", destination_site_id: "SITE-SUMMIT-SLC", kg: 3600 }], order_recovery: [], financial: [] } },
      { rev: 34800, nrv: 33900, p10: 14200, p90: 40000, pen: 900 }, { p_accept: 0.62, sl: 10.4, kg: 2232 }, 1, 30600),
    mk("OPT-00000142", "Inspect L-B at Central Valley DC; short the Summit line until the inspection result", { is_fallback: true, expires_at: DEADLINE,
      bundle: { lots: [{ lot_id: "L-B", disposition: "INSPECT", destination_site_id: "SITE-CVDC-TRACY", kg: 3600, carrier_party_id: "PARTY-SIERRA" }],
        order_recovery: [{ order_line_id: "SO-6002-10", action: "SHORT", kg: 3600, replacement_lot_id: null, from_site_id: null, repromise_at: at("10:00:00", "2026-10-08") }],
        financial: [{ action: "DEFER", counterparty_party_id: "PARTY-EMERALD-RIDGE", basis: "GROWER_PRECOOL", amount_usd: null, variant: null }] } },
      { rev: 34900, nrv: 33400, p10: 29800, p90: 35600, freight: 500, insp: 350, pen: 650 }, { p_accept: 0.91, sl: 9.6, kg: 3276, short: 3600 }, 2, 30350),
    mk("OPT-00000143", "Re-route L-B to Harbor Foodservice, Oakland; short the Summit line", { expires_at: at("10:20:00"),
      bundle: { lots: [{ lot_id: "L-B", disposition: "REROUTE", destination_site_id: "SITE-HARBOR-OAK", kg: 3600, carrier_party_id: "PARTY-SIERRA" }],
        order_recovery: [{ order_line_id: "SO-6002-10", action: "SHORT", kg: 3600, replacement_lot_id: null, from_site_id: null, repromise_at: null }],
        financial: [] } },
      { rev: 32040, nrv: 28700, p10: 27900, p90: 29300, freight: 700, pen: 2640 }, { p_accept: 0.99, sl: 10.1, kg: 3600, short: 3600 }, 3, 28200),
  ];
}

const NARRATIVE =
  "Inspect L-B at Central Valley DC before committing it to Summit Club. " +
  "Continuing scores $250 higher, but its value depends on an inspection certificate the primary probe contradicts by 3.2 C. " +
  "Inspection costs $350 plus handling and keeps the Harbor re-route open until 10:20.";

function spans(text: string, sentences: string[]) {
  const cps = Array.from(text);
  return sentences.map((s) => {
    const start = Array.from(text.slice(0, text.indexOf(s))).length;
    return { start, end: Math.min(cps.length, start + Array.from(s).length) };
  });
}

function brief(opts: Option[]): Brief {
  const b = fixture<Brief>("brief");
  const [cont, insp, harbor] = opts as [Option, Option, Option];
  b.case_id = SB_CASE;
  b.pack_id = PACK;
  b.generated_at = at("07:05:40");
  b.brief_hash = fakeHash("brief-S-B-1");
  b.do_nothing = { option_id: cont.option_id, outcome: clone(cont.outcome) };
  b.options = [insp, harbor].map((o) => ({ option_id: o.option_id, label: o.label, outcome: clone(o.outcome), flags: o.flags, expires_at: o.expires_at }));
  b.value_table = [cont, insp, harbor].map((o) => ({
    option_id: o.option_id, expected_nrv_usd: o.outcome.financial.expected_nrv_usd, nrv_p10_usd: o.outcome.financial.nrv_p10_usd,
    nrv_p90_usd: o.outcome.financial.nrv_p90_usd, value_preserved_vs_default_usd: o.outcome.financial.value_preserved_vs_default_usd,
  }));
  b.eliminated = [];
  b.comparison = {
    ranking: [cont.option_id, insp.option_id, harbor.option_id], non_dominated: [cont.option_id, insp.option_id],
    margin_top2_usd: 250.0, objective_version: "objective@1",
    escalation_reasons: ["NEAR_TIE", "STRATEGIC_CUSTOMER", "MODEL_OUT_OF_RANGE"],
    p_liab_attribution_only: 0.01, p_liab_with_finding: 0.0,
  };
  b.precedents = [];
  b.recommendation = {
    option_id: insp.option_id, rec_id: REC, decided_by: "AGENT", decider_id: "RECOVERY_STRATEGIST@1",
    why_structured: ["NEAR_TIE_RESOLVED_BY_EVIDENCE_TRUST", "PRESERVES_REROUTE_WINDOW", "TIER_A_COMMITMENT_PROTECTED"],
    narrative: NARRATIVE,
  };
  return b;
}

function trace(runId: string, start: string, events: [number, Omit<TraceEvent, "run_id" | "seq" | "at">][]): Step[] {
  let t = Date.parse(start);
  return events.map(([delay, e], seq) => {
    t += delay;
    return { delay_ms: delay, event: { run_id: runId, seq, at: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"), ...e } as TraceEvent };
  });
}

const tool = (name: string, id: string): Omit<TraceEvent, "run_id" | "seq" | "at"> => ({ kind: "TOOL_USE", tool: { name, tool_use_id: id } });
const result = (id: string, status: string, ids: string[]): Omit<TraceEvent, "run_id" | "seq" | "at"> => ({ kind: "TOOL_RESULT", tool_result: { tool_use_id: id, status, evidence_ids: ids } });

const FORENSICS = trace(RUN_F, at("07:00:50"), [
  [400, { kind: "STATUS", text: "Planning" }],
  [900, tool("GET_CASE_CONTEXT", "tu_f1")],
  [700, result("tu_f1", "OK", [`EV:PACK:${PACK}#/lots/0`, `EV:PACK:${PACK}#/custody_timeline/0`])],
  [800, { kind: "THINKING", text: "The certificate and the probe disagree at loading. Check the probe trace and the reefer air first." }],
  [900, tool("GET_TELEMETRY_WINDOW", "tu_f2")],
  [900, result("tu_f2", "OK", ["EV:TEL:L-B:2026-10-06T01:00Z-2026-10-06T07:00Z:BUCKET_15M"])],
  [700, tool("GET_DOCUMENT_EVIDENCE", "tu_f3")],
  [600, result("tu_f3", "OK", ["EV:DOC:DOC-SFI-044813#pulp_temp_at_loading_c"])],
  [800, tool("ANALYZE_CAUSAL_SIGNATURES", "tu_f4")],
  [1100, result("tu_f4", "OK", ["EV:SIG:PRECOOL_DELAY@1", "EV:SIG:REEFER_PULLDOWN_FAILURE@1", "EV:SIG:DOCK_DWELL@1"])],
  [1200, { kind: "TEXT", text: "Pre-cool delay is supported: pulp stayed above 3 C for 5 h after harvest while the packhouse held the lot; the reefer held supply air at setpoint." }],
  [700, tool("SUBMIT_CAUSATION_FINDING", "tu_f5")],
  [900, result("tu_f5", "ACCEPTED", [])],
  [300, { kind: "DONE" }],
]);

const STRATEGIST = trace(RUN_S, at("07:05:45"), [
  [400, { kind: "STATUS", text: "Planning" }],
  [800, tool("GET_SCORED_OPTIONS", "tu_s1")],
  [800, result("tu_s1", "OK", ["EV:OPT:OPT-00000141", "EV:OPT:OPT-00000142", "EV:OPT:OPT-00000143"])],
  [900, { kind: "THINKING", text: "Continue and inspect are $250 apart. Continue relies on the 1.0 C certificate, which Forensics rated LOW trust." }],
  [800, tool("SIMULATE_OPTION_VARIANTS", "tu_s2")],
  [1300, result("tu_s2", "OK", ["EV:OPT:OPT-00000142"])],
  [700, tool("GET_PARTY_CONTEXT", "tu_s3")],
  [700, result("tu_s3", "OK", ["EV:PARTY:PARTY-SUMMIT"])],
  [1000, { kind: "TEXT", text: NARRATIVE }],
  [700, tool("SUBMIT_RECOMMENDATION", "tu_s4")],
  [900, result("tu_s4", "ACCEPTED", [])],
  [300, { kind: "DONE" }],
]);

const AUDITOR = trace(RUN_A, at("07:07:30"), [
  [400, { kind: "STATUS", text: "Planning" }],
  [700, tool("GET_ARTIFACT_FOR_AUDIT", "tu_a1")],
  [900, result("tu_a1", "OK", ["EV:OPT:OPT-00000141", "EV:OPT:OPT-00000142", "EV:DOC:DOC-SFI-044813#pulp_temp_at_loading_c"])],
  [1200, { kind: "THINKING", text: "Check each sentence: the $250 gap, the 3.2 C contradiction, the $350 inspection cost and the 10:20 window." }],
  [800, tool("SUBMIT_AUDIT_VERDICT", "tu_a2")],
  [700, result("tu_a2", "ACCEPTED", [])],
  [300, { kind: "DONE" }],
]);

function run(runId: string, agent: Run["agent"], model: string, startedAt: string, steps: Step[], done: boolean, budget: number): Run {
  const last = steps.at(-1)!.event.at;
  return {
    run_id: runId, decision_point: "D1", agent, provider: "cortex-agent", model, spec_version: "1",
    status: done ? "COMPLETED" : "STARTED", call_budget: budget,
    calls_used: done ? steps.filter((s) => s.event.kind === "TOOL_USE").length : 0, started_at: startedAt,
    ended_at: done ? last : null, latency_ms: done ? Date.parse(last) - Date.parse(startedAt) : null,
    trace: done ? steps.map((s) => s.event) : [], trace_truncated: false,
    tool_calls: done
      ? steps.filter((s) => s.event.kind === "TOOL_USE").map((s, i) => {
          const res = steps.find((r) => r.event.kind === "TOOL_RESULT" && r.event.tool_result?.tool_use_id === s.event.tool?.tool_use_id)!;
          return {
            call_seq: i + 1, tool: s.event.tool!.name, status: res.event.tool_result!.status, latency_ms: Date.parse(res.event.at) - Date.parse(s.event.at),
            evidence_ids: res.event.tool_result!.evidence_ids, args_hash: fakeHash(`${runId}-args-${i}`), result_hash: fakeHash(`${runId}-result-${i}`), called_at: s.event.at,
          };
        })
      : [],
  };
}

export function buildSB(policyRow: unknown): Tape {
  const ledger = new LedgerChain(500, fakeHash("ledger-head-before-S-B"));
  const opts = options();
  const thePack = pack();
  const theBrief = brief(opts);
  const frames: TapeFrame[] = [];
  const extras = { inboxRank: 1, fallbackAt: null as string | null };
  const ctx = { choosable: ["OPT-00000141", "OPT-00000143"] };

  const detection = {
    case_id: SB_CASE, decision_point: "D1", episode_key: `${SHIPMENT}#2026-10-06T00:20Z`, shipment_id: SHIPMENT, severity: "MEDIUM",
    onset_at: at("00:20:00"), holder_party_id_at_onset: "PARTY-EMERALD-RIDGE", holder_type_at_onset: "PACKHOUSE",
    lots: [{ lot_id: "L-B", onset_at: at("00:20:00"), detected_at: at("06:58:00"), breach_min_in_window: 34, max_pulp_c: 4.4, holder_party_id_at_onset: "PARTY-EMERALD-RIDGE" }],
    rule: { detection_window_min: 60, tolerance_min: 30, threshold_c: 1.8, policy_version: "1" },
    run_id: "DET-20261006-0658",
  };
  const view = baseView({
    case_id: SB_CASE, decision_point: "D1", state: "OPEN", state_version: 1, severity: "MEDIUM", episode_key: detection.episode_key,
    shipment_id: SHIPMENT, onset_at: at("00:20:00"), detected_at: at("06:58:00"), opened_at: at("06:58:40"), opened_by: TASK_USER,
    holder_party_id_at_onset: "PARTY-EMERALD-RIDGE", holder_type_at_onset: "PACKHOUSE", policy_version: "1", deadline_ts: null,
    value_at_risk_usd: null, current_pack_id: null, current_rec_id: null, current_brief_hash: null, needs_reassessment: false,
    provenance: "LIVE", updated_at: at("06:58:40"),
    lots: [{ lot_id: "L-B", added_at: at("06:58:40"), onset_at: at("00:20:00"), detected_at: at("06:58:00"), breach_min_at_detection: 34, max_pulp_c: 4.4, holder_party_id_at_onset: "PARTY-EMERALD-RIDGE" }],
  }, detection);
  const from = at("23:30:00", "2026-10-05");
  view.analysis.thermal = [thermal({
    lotId: "L-B", thresholdC: 1.8, trefC: 0, q10: 3.2, from, to: at("06:59:00"),
    holders: [{ from, party: "PARTY-EMERALD-RIDGE", type: "PACKHOUSE" }, { from: at("06:20:00"), party: "PARTY-SIERRA", type: "CARRIER" }],
    pulp: curve([[from, 16.0], [at("00:20:00"), 9.5], [at("04:30:00"), 5.4], [at("06:20:00"), 4.4], [at("06:59:00"), 4.2]]),
  })];
  ledger.append(at("06:58:40"), "CASE_OPENED", SB_CASE, TASK_USER, `BBC_OS.DECISION.CASES#${SB_CASE}`, detection);
  frames.push(frame("Excursion detected at the first handoff: lot left pre-cooling warm", view, ledger, ctx, extras));

  // ---- ANALYSIS: conflict escalates to Forensics -----------------------------------------
  transition(view, "ASSESSED", at("07:00:41"));
  view.analysis.pack = thePack;
  view.analysis.packs = [{ pack_id: PACK, decision_point: "D1", revision: 1, as_of: thePack.as_of, sealed_at: thePack.sealed_at, content_hash: thePack.content_hash }];
  Object.assign(view.case, { current_pack_id: PACK, value_at_risk_usd: 18144.0, deadline_ts: DEADLINE });
  ledger.append(at("07:00:41"), "ASSESSMENT_SEALED", SB_CASE, ENGINE_USER, `BBC_OS.EVIDENCE.EVIDENCE_PACKS#${PACK}`, { pack_id: PACK, content_hash: thePack.content_hash });
  transition(view, "FORENSICS_PENDING", at("07:00:42"));
  extras.fallbackAt = DEADLINE;
  view.governance.fallback = { option_id: "OPT-00000142", label: "Inspect at Central Valley DC (safe fallback)", runs_at: DEADLINE };
  ledger.append(at("07:00:42"), "TRANSITION", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SB_CASE}`, { from: "ASSESSED", to: "FORENSICS_PENDING", triggers: ["EVIDENCE_CONFLICT"] });
  view.agents.runs = [run(RUN_F, "EXCURSION_FORENSICS", CLAUDE, at("07:00:50"), FORENSICS, false, 12)];
  ledger.append(at("07:00:50"), "AGENT_RUN", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.AGENT_RUNS#${RUN_F}`, { run_id: RUN_F, agent: "EXCURSION_FORENSICS", status: "STARTED" });
  frames.push(frame("Certificate contradicts the probe: Excursion Forensics is investigating", view, ledger, ctx, extras));

  transition(view, "FINDING_RECORDED", at("07:01:04"));
  view.agents.runs = [run(RUN_F, "EXCURSION_FORENSICS", CLAUDE, at("07:00:50"), FORENSICS, true, 12)];
  const finding = fixture<NonNullable<CaseView["analysis"]["findings"][number]["finding"]>>("finding");
  view.analysis.findings = [{
    finding_id: FIND, decision_point: "D1", revision: 1, pack_id: PACK, decider_kind: "AGENT", run_id: RUN_F, status: "ACCEPTED",
    unadjudicated: false, confidence: "MEDIUM", finding, finding_hash: canonicalHash(finding), created_at: at("07:01:03"), created_by: "BBC_AGENT_SVC",
  }];
  ledger.append(at("07:01:03"), "FINDING", SB_CASE, "BBC_AGENT_SVC", `BBC_OS.DECISION.CAUSATION_FINDINGS#${FIND}`, { finding_id: FIND, most_likely_cause: "PRECOOL_DELAY", finding_hash: canonicalHash(finding) });
  ledger.append(at("07:01:04"), "AGENT_RUN", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.AGENT_RUNS#${RUN_F}`, { run_id: RUN_F, status: "COMPLETED" });
  frames.push(frame("Finding recorded: pre-cool delay at the packhouse (carrier not responsible)", view, ledger, ctx, extras));

  // ---- OPTIONS -> DECISION: near-tie escalates to the Strategist ------------------------
  transition(view, "OPTIONS_SCORED", at("07:05:38"));
  view.options = opts;
  ledger.append(at("07:05:38"), "OPTIONS_SCORED", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.OPTIONS#${PACK}/1`, { option_ids: opts.map((o) => o.option_id) });
  transition(view, "STRATEGY_PENDING", at("07:05:40"));
  ledger.append(at("07:05:40"), "TRANSITION", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SB_CASE}`, { from: "OPTIONS_SCORED", to: "STRATEGY_PENDING", triggers: ["NEAR_TIE", "STRATEGIC_CUSTOMER", "MODEL_OUT_OF_RANGE"] });
  view.agents.runs.push(run(RUN_S, "RECOVERY_STRATEGIST", CLAUDE, at("07:05:45"), STRATEGIST, false, 10));
  ledger.append(at("07:05:45"), "AGENT_RUN", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.AGENT_RUNS#${RUN_S}`, { run_id: RUN_S, agent: "RECOVERY_STRATEGIST", status: "STARTED" });
  frames.push(frame("Near-tie on a tier-A line: the Recovery Strategist is weighing the options", view, ledger, ctx, extras));

  transition(view, "RECOMMENDED", at("07:07:20"));
  view.agents.runs[1] = run(RUN_S, "RECOVERY_STRATEGIST", CLAUDE, at("07:05:45"), STRATEGIST, true, 10);
  view.case.current_rec_id = REC;
  view.case.current_brief_hash = theBrief.brief_hash;
  view.decision.recommendations = [{
    rec_id: REC, decision_point: "D1", option_id: "OPT-00000142", decided_by: "AGENT", decider_id: "RECOVERY_STRATEGIST@1", run_id: RUN_S,
    escalation_reasons: ["NEAR_TIE", "STRATEGIC_CUSTOMER", "MODEL_OUT_OF_RANGE"], status: "ACTIVE", audit_status: "PENDING",
    brief: theBrief, brief_hash: theBrief.brief_hash, submission: fixture("recommendation"), audit_verdict: null, audited_text: NARRATIVE,
    created_at: at("07:07:20"),
  }];
  ledger.append(at("07:07:20"), "RECOMMENDATION", SB_CASE, "BBC_AGENT_SVC", `BBC_OS.DECISION.RECOMMENDATIONS#${REC}`, { rec_id: REC, option_id: "OPT-00000142", decided_by: "AGENT", brief_hash: theBrief.brief_hash });
  transition(view, "AUDIT_PENDING", at("07:07:22"));
  view.agents.runs.push(run(RUN_A, "EVIDENCE_AUDITOR", AUDITOR_MODEL, at("07:07:30"), AUDITOR, false, 6));
  ledger.append(at("07:07:30"), "AGENT_RUN", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.AGENT_RUNS#${RUN_A}`, { run_id: RUN_A, agent: "EVIDENCE_AUDITOR", model: AUDITOR_MODEL, status: "STARTED" });
  frames.push(frame("Strategist recommends inspection; the Evidence Integrity Auditor is checking the narrative", view, ledger, ctx, extras));

  // ---- Audit PASS -> policy evaluation -> approvals ---------------------------------------
  const sentences = [
    "Inspect L-B at Central Valley DC before committing it to Summit Club.",
    "Continuing scores $250 higher, but its value depends on an inspection certificate the primary probe contradicts by 3.2 C.",
    "Inspection costs $350 plus handling and keeps the Harbor re-route open until 10:20.",
  ];
  const ev = [["EV:OPT:OPT-00000142"], ["EV:OPT:OPT-00000141", "EV:DOC:DOC-SFI-044813#pulp_temp_at_loading_c"], ["EV:OPT:OPT-00000142", "EV:OPT:OPT-00000143"]];
  const verdict = {
    statements: spans(NARRATIVE, sentences).map((span, i) => ({ span, statement: sentences[i]!, verdict: "SUPPORTED" as const, evidence_ids: ev[i]! })),
    overall: "PASS" as const,
    required_fixes: [],
  };
  transition(view, "AUDITED", at("07:07:39"));
  view.agents.runs[2] = run(RUN_A, "EVIDENCE_AUDITOR", AUDITOR_MODEL, at("07:07:30"), AUDITOR, true, 6);
  Object.assign(view.decision.recommendations[0]!, { audit_status: "PASS", audit_verdict: verdict });
  ledger.append(at("07:07:39"), "AUDIT_VERDICT", SB_CASE, "BBC_AGENT_SVC", `BBC_OS.DECISION.RECOMMENDATIONS#${REC}`, { rec_id: REC, overall: "PASS", model: AUDITOR_MODEL, author_model: CLAUDE });
  transition(view, "PENDING_APPROVAL", at("07:07:41"));
  view.governance.evaluations = [{
    eval_id: EVAL, rec_id: REC, policy_version: "1", outcome: "APPROVE", autonomy_level: 4,
    required_roles: ["BBC_QUALITY_MGR", "BBC_SALES_MGR"], dual_approval: true, shadow: false, matched_rules: ["DR-05", "DR-08"],
    value_at_risk_usd: 18144.0,
    reasons: ["DR-08: an AI-chosen D1 recovery above $10,000 never self-executes", "DR-05: shorting SO-6002-10 changes a tier-A commitment"],
    dimensions: [
      { dimension: "financial", metric: "action_value_usd", value: 33400, band: "L4", approver_roles: ["BBC_FINANCE_MGR"] },
      { dimension: "customer", metric: "tier_a_lines_affected", value: 1, band: "L4", approver_roles: ["BBC_SALES_MGR"] },
      { dimension: "operational", metric: "p_reject", value: 0.09, band: "L4", approver_roles: ["BBC_QUALITY_MGR"] },
      { dimension: "confidence", metric: "confidence_rank", value: 1, band: "L4", approver_roles: [] },
      { dimension: "data_quality", metric: "unresolved_conflicts", value: 0, band: "L3", approver_roles: [] },
    ],
    created_at: at("07:07:41"),
  }];
  const approval = (id: string, role: "BBC_SALES_MGR" | "BBC_QUALITY_MGR") => ({
    approval_id: id, eval_id: EVAL, rec_id: REC, required_role: role, status: "REQUESTED" as const, requested_at: at("07:07:41"), due_at: DEADLINE,
    brief_hash_at_request: theBrief.brief_hash, proposer: "BBC_AGENT_SVC", decided_by: null, decided_role: null, decided_at: null,
    chosen_option_id: null, reason: null, freshness: { brief_fresh: true, pack_fresh: true, checked_at: at("07:07:41") },
  });
  view.governance.approvals = [approval(APR_QUALITY, "BBC_QUALITY_MGR"), approval(APR_SALES, "BBC_SALES_MGR")];
  ledger.append(at("07:07:41"), "POLICY_EVALUATION", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.POLICY_EVALUATIONS#${EVAL}`, { eval_id: EVAL, outcome: "APPROVE", required_roles: ["BBC_QUALITY_MGR", "BBC_SALES_MGR"] });
  const pending = frames.push(frame("Audit PASS: awaiting Quality and Sales (AI-chosen, dual approval)", view, ledger, ctx, extras)) - 1;
  const pendingView = clone(view);
  const pendingSeq = ledger.lastSeq!;

  const decide = (v: CaseView, l: LedgerChain, id: string, persona: "sales" | "quality", ts: string) => {
    const a = v.governance.approvals.find((x) => x.approval_id === id)!;
    Object.assign(a, { status: "APPROVED", decided_by: PERSONA_IDS[persona].user, decided_role: PERSONA_IDS[persona].role, decided_at: ts,
      freshness: { brief_fresh: true, pack_fresh: true, checked_at: ts } });
    v.case.state_version += 1;
    v.case.updated_at = ts;
    v.generated_at = ts;
    l.append(ts, "APPROVAL", SB_CASE, PERSONA_IDS[persona].user, `BBC_OS.DECISION.APPROVALS#${id}`, { approval_id: id, verdict: "APPROVE", role: PERSONA_IDS[persona].role, brief_hash: theBrief.brief_hash });
  };
  decide(view, ledger, APR_QUALITY, "quality", at("07:19:12"));
  const qualityDone = frames.push(frame("Quality approved; awaiting Sales", view, ledger, ctx, extras)) - 1;
  decide(view, ledger, APR_SALES, "sales", at("07:24:50"));

  // ---- EXECUTION ---------------------------------------------------------------------------
  transition(view, "APPROVED", at("07:24:50"));
  transition(view, "EXECUTING", at("07:24:51"));
  extras.fallbackAt = null;
  view.governance.fallback = null;
  const approvers = [
    { user: PERSONA_IDS.quality.user, role: "BBC_QUALITY_MGR", approval_id: APR_QUALITY },
    { user: PERSONA_IDS.sales.user, role: "BBC_SALES_MGR", approval_id: APR_SALES },
  ];
  const common = {
    planId: PLAN, caseId: SB_CASE, decisionPoint: "D1" as const, recId: REC, optionId: "OPT-00000142", briefHash: theBrief.brief_hash, packId: PACK,
    evalId: EVAL, decider: { kind: "AGENT" as const, id: "RECOVERY_STRATEGIST@1", runId: RUN_S, model: CLAUDE, spec: "1" }, proposedAt: at("07:07:40"),
  };
  const muts = [
    mutation({ ...common, mutationId: "MUT-00000320", stepSeq: 1, actionType: "REROUTE", targetSystem: "TMS", target: { type: "SHIPMENT", id: SHIPMENT },
      payload: { shipment_id: SHIPMENT, lot_id: "L-B", new_destination_site_id: "SITE-CVDC-TRACY", disposition: "INSPECT" }, expectedBefore: { status: "IN_TRANSIT", destination_site_id: "SITE-SUMMIT-SLC" },
      expectedAfter: { destination_site_id: "SITE-CVDC-TRACY" }, approvalIds: [APR_QUALITY, APR_SALES], autonomyLevel: 4, approvers }),
    mutation({ ...common, mutationId: "MUT-00000321", stepSeq: 2, actionType: "STOCK_BLOCK", targetSystem: "SAP", target: { type: "LOT_STOCK", id: "L-B@SITE-CVDC-TRACY" },
      payload: { lot_id: "L-B", site_id: "SITE-CVDC-TRACY", kg: 3600 }, expectedBefore: { blocked: false }, expectedAfter: { blocked: true },
      approvalIds: [], autonomyLevel: 3, approvers: [] }),
    mutation({ ...common, mutationId: "MUT-00000322", stepSeq: 3, actionType: "REPROMISE_NOTICE", targetSystem: "CUSTOMER_EDI", target: { type: "SALES_ORDER_ITEM", id: "SO-6002-10" },
      payload: { customer_party_id: "PARTY-SUMMIT", repromise_at: "2026-10-08T10:00:00Z", template: "EDI-865-REPROMISE@1" }, expectedBefore: { promised_at: "2026-10-07T10:00:00Z" },
      expectedAfter: { promised_at: "2026-10-08T10:00:00Z" }, approvalIds: [APR_QUALITY, APR_SALES], autonomyLevel: 4, approvers }),
  ];
  const refs = ["TMS-RR-88240", "SAP-MD344-4410021", "EDI865-20261006-0007"];
  muts.forEach((m, i) => {
    const s = m.record!.timestamps as Record<string, string | null>;
    s["evaluated_at"] = at("07:07:41");
    s["approved_at"] = m.record!.approval_ids.length ? at("07:24:50") : null;
    advanceMutation(m, "AUTHORIZED", at("07:24:51"));
    const t0 = Date.parse(at("07:24:53")) + i * 4000;
    const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
    advanceMutation(m, "DISPATCHED", iso(t0));
    advanceMutation(m, "ACKED", iso(t0 + 1500), { externalRef: refs[i]! });
    advanceMutation(m, "VERIFIED", iso(t0 + 2500));
  });
  view.execution.plans = [{ plan_id: PLAN, rec_id: REC, atomicity: "ALL_OR_NOTHING", status: "DONE",
    steps: muts.map((m) => ({ step_seq: m.step_seq!, action_type: m.action_type, target_system: m.target_system, mutation_id: m.mutation_id })),
    created_at: at("07:24:51"), updated_at: at("07:25:08") }];
  view.execution.mutations = muts;
  ledger.append(at("07:24:51"), "TRANSITION", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SB_CASE}`, { from: "APPROVED", to: "EXECUTING", plan_id: PLAN });
  for (const m of muts) ledger.append(at("07:24:51"), "ACTION_QUEUED", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#${m.mutation_id}`, { mutation_id: m.mutation_id, action_type: m.action_type });
  muts.forEach((m, i) => ledger.append(at("07:25:08"), "ACTION_ACKED", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#${m.mutation_id}`, { mutation_id: m.mutation_id, status: "VERIFIED", external_ref: refs[i] }));
  transition(view, "EXECUTED", at("07:25:09"));
  transition(view, "AWAITING_OUTCOME", at("07:25:10"));
  ledger.append(at("07:25:10"), "TRANSITION", SB_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SB_CASE}`, { from: "EXECUTED", to: "AWAITING_OUTCOME" });
  const executed = frames.push(frame("Executed: re-routed to Central Valley DC for inspection; Summit re-promised (EDI 865)", view, ledger, ctx, extras)) - 1;

  // ---- Branch: Sales approves first ---------------------------------------------------------
  const branch = new LedgerChain(500, fakeHash("ledger-head-before-S-B"));
  for (const e of ledger.entries.filter((x) => x.seq <= pendingSeq)) branch.append(e.ts, e.entry_type, SB_CASE, e.actor, e.record_ref, ledger.payloadOf.get(e.seq));
  decide(pendingView, branch, APR_SALES, "sales", at("07:15:30"));
  const salesFirst = frames.push(frame("Sales approved; awaiting Quality", pendingView, branch, ctx, { inboxRank: 1, fallbackAt: DEADLINE })) - 1;

  const v = (i: number) => frames[i]!.cases[SB_CASE]!.view;
  const ok = (id: string, f: number, remaining: string[], bump = 0) => ({
    status: "OK", approval_id: id, approval_status: "APPROVED", ledger_seq: v(f).evidence.ledger.last_seq! + bump,
    case_state: remaining.length ? "PENDING_APPROVAL" : "APPROVED",
  });
  const responses: TapeResponse[] = [
    { call: "DECIDE_APPROVAL", persona: "quality", at_frames: [pending], match: { approval_id: APR_QUALITY, verdict: "APPROVE" },
      result: ok(APR_QUALITY, qualityDone, [APR_SALES]), advance_to_frame: qualityDone },
    { call: "DECIDE_APPROVAL", persona: "sales", at_frames: [qualityDone], match: { approval_id: APR_SALES, verdict: "APPROVE" },
      result: ok(APR_SALES, qualityDone, [], 1), advance_to_frame: executed },
    { call: "DECIDE_APPROVAL", persona: "sales", at_frames: [pending], match: { approval_id: APR_SALES, verdict: "APPROVE" },
      result: ok(APR_SALES, salesFirst, [APR_QUALITY]), advance_to_frame: salesFirst },
    { call: "DECIDE_APPROVAL", persona: "quality", at_frames: [salesFirst], match: { approval_id: APR_QUALITY, verdict: "APPROVE" },
      result: ok(APR_QUALITY, salesFirst, [], 1), advance_to_frame: executed },
  ];
  return {
    tape: "S-B",
    title: "S-B: conflicting evidence, three agents, two approvals",
    provenance: "SYNTHETIC (design numbers)",
    description:
      "A lot leaves pre-cooling warm. The inspection certificate claims 1.0 C; the primary probe reads 4.2 C. Forensics attributes the " +
      "excursion to the packhouse, the Strategist resolves a $250 near-tie by evidence trust, and an auditor from a different model family " +
      "checks every sentence. Quality and Sales approve; the gateway re-routes to inspection and re-promises the tier-A line.",
    personas: PERSONA_IDS,
    frames: frames as Tape["frames"],
    responses: [...responses, ...proofResponses(frames, SB_CASE, ledger, 503, policyRow)],
    analyst: [],
    agent_traces: { [RUN_F]: FORENSICS, [RUN_S]: STRATEGIST, [RUN_A]: AUDITOR },
  };
}
