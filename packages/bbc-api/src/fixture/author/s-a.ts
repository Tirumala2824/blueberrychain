/**
 * Tape S-A (docs/demo/scenarios.md): reefer compressor failure on a tier-A organic lot,
 * rule-decided re-route to Bayline with the Summit line refilled from Central Valley DC
 * stock. Numbers are the contract fixtures' (the Phase 11 worked example, illustrative).
 * Dual approval: Sales (DR-04, re-route above $25k) and Quality (the operational
 * reversibility dimension lands in L4 under policy v1).
 */

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
  plusMin,
  proofResponses,
  thermal,
  transition,
  type CaseView,
  type Option,
  type Tape,
  type TapeFrame,
  type TapeResponse,
} from "./kit.js";

export const SA_CASE = "CASE-00000017";
const PACK = "PACK-00000031";
const REC = "REC-00000044";
const EVAL = "EVAL-00000050";
const APR_SALES = "APR-00000060";
const APR_QUALITY = "APR-00000061";
const PLAN = "PLAN-00000012";
const FIND = "FND-00000020";
const CLAIM = "CLM-00000070";
const SHIPMENT = "SHP-20261006-114";
const DEADLINE = at("09:35:00");

type Pack = NonNullable<CaseView["analysis"]["pack"]>;
type Brief = NonNullable<CaseView["decision"]["recommendations"][number]["brief"]>;

function pack(): Pack {
  const p = fixture<Pack>("evidence_pack");
  p.as_of = at("07:21:00");
  p.sealed_at = at("07:21:12");
  p.shipment.reefer_state = { as_of: at("07:16:00"), mode: "CONTINUOUS", alarms: ["COMPRESSOR_FAULT"], supply_air_c: 9.8, return_air_c: 8.9, setpoint_c: 0.5 };
  const lot = p.lots[0]!;
  lot.last_pulp_c = 3.0;
  lot.last_reading_at = at("07:20:00");
  lot.values.forEach((v) => {
    v.as_of = at("07:20:00");
  });
  return p;
}

function variant(base: Option, patch: Partial<Option> & Pick<Option, "option_id" | "label">): Option {
  const o = { ...clone(base), ...patch };
  o.evidence_id = `EV:OPT:${o.option_id}`;
  o.provenance = { ...o.provenance, seed: 418800 + Number(o.option_id.slice(-3)) };
  return o;
}

function options(): Option[] {
  const reroute = fixture<Option>("option", 0);
  const doNothing = fixture<Option>("option", 1);
  reroute.expires_at = DEADLINE;
  const inspect = variant(reroute, {
    option_id: "OPT-00000103",
    label: "Inspect L-A at Central Valley DC, then sell on observed shelf life; refill Summit from DC stock",
    is_fallback: true,
    expires_at: at("13:00:00"),
    bundle: {
      lots: [{ lot_id: "L-A", disposition: "INSPECT", destination_site_id: "SITE-CVDC-TRACY", kg: 4200, carrier_party_id: "PARTY-SIERRA" }],
      order_recovery: clone(reroute.bundle.order_recovery),
      financial: clone(reroute.bundle.financial),
    },
    outcome: {
      ...clone(reroute.outcome),
      operational: { p_accept: 0.86, sl_at_arrival_days_p10: 7.6, sl_at_arrival_days_p50: 8.3, sl_at_arrival_days_p90: 9.0, kg_delivered_expected: 3612 },
      financial: {
        expected_revenue_usd: 31183.0, costs: { inspection_usd: 350.0, freight_delta_usd: 500.0, replacement_usd: 400.0 },
        expected_penalties_usd: 0.0, expected_recovery_usd: 2213.0, expected_nrv_usd: 32146.0, nrv_p10_usd: 30900.0,
        nrv_p90_usd: 33100.0, expected_loss_usd: 14894.0, value_preserved_vs_default_usd: 6461.0,
      },
      risk: { p_reject: 0.14, food_safety_flag: false, evidence_risk: "LOW" },
      recovery_cost_usd: 1250.0,
      confidence: { level: "MEDIUM", drivers: ["inspection resolves shelf-life uncertainty", "waiting truck costs detention"] },
    },
    score: { risk_adjusted_usd: 31700.0, rank: 2, dominated_by: ["OPT-00000102"], objective_version: "objective@1" },
  });
  const processor = variant(reroute, {
    option_id: "OPT-00000104",
    label: "Divert L-A to Valley Fruit Processing, Fresno; refill Summit from DC stock",
    expires_at: at("12:00:00"),
    bundle: {
      lots: [{ lot_id: "L-A", disposition: "DOWNGRADE", destination_site_id: "SITE-VFP-FRESNO", kg: 4200, carrier_party_id: "PARTY-SIERRA" }],
      order_recovery: clone(reroute.bundle.order_recovery),
      financial: clone(reroute.bundle.financial),
    },
    outcome: {
      ...clone(reroute.outcome),
      operational: { p_accept: 0.99, sl_at_arrival_days_p50: 8.9, kg_delivered_expected: 4200 },
      financial: {
        expected_revenue_usd: 14700.0, costs: { freight_delta_usd: 600.0, replacement_usd: 400.0 },
        expected_penalties_usd: 0.0, expected_recovery_usd: 12485.0, expected_nrv_usd: 26185.0, nrv_p10_usd: 25600.0,
        nrv_p90_usd: 26700.0, expected_loss_usd: 20855.0, value_preserved_vs_default_usd: 500.0,
      },
      recovery_cost_usd: 1000.0,
      confidence: { level: "HIGH", drivers: ["processor accepts any shelf life above 1 day"] },
    },
    score: { risk_adjusted_usd: 25900.0, rank: 3, dominated_by: ["OPT-00000102"], objective_version: "objective@1" },
  });
  const expedite = variant(reroute, {
    option_id: "OPT-00000105",
    label: "Expedite to Summit Club Salt Lake City DC",
    feasible: false,
    expires_at: at("07:21:00"),
    eliminations: [{ code: "SPEC_INFEASIBLE", detail: "P(accept) 0.01 < 0.80; arrival shelf life about 8.3 days vs a 10-day spec", evidence_id: "EV:OPT:OPT-00000105" }],
    bundle: {
      lots: [{ lot_id: "L-A", disposition: "EXPEDITE", destination_site_id: "SITE-SUMMIT-SLC", kg: 4200, carrier_party_id: "PARTY-SIERRA" }],
      order_recovery: [],
      financial: clone(reroute.bundle.financial),
    },
    outcome: {
      ...clone(doNothing.outcome),
      operational: { p_accept: 0.01, sl_at_arrival_days_p50: 8.3, kg_delivered_expected: 42 },
      recovery_cost_usd: 900.0,
    },
    score: { risk_adjusted_usd: 24800.0, rank: null, dominated_by: [], objective_version: "objective@1" },
  });
  return [reroute, inspect, processor, doNothing, expedite];
}

function brief(opts: Option[]): Brief {
  const b = fixture<Brief>("brief");
  b.generated_at = at("07:21:40");
  const byId = new Map(opts.map((o) => [o.option_id, o]));
  const feasible = ["OPT-00000102", "OPT-00000103", "OPT-00000104"].map((id) => byId.get(id)!);
  b.options = feasible.map((o) => ({ option_id: o.option_id, label: o.label, outcome: clone(o.outcome), flags: [], expires_at: o.expires_at }));
  b.value_table = [...feasible, byId.get("OPT-00000101")!].map((o) => ({
    option_id: o.option_id,
    expected_nrv_usd: o.outcome.financial.expected_nrv_usd,
    nrv_p10_usd: o.outcome.financial.nrv_p10_usd,
    nrv_p90_usd: o.outcome.financial.nrv_p90_usd,
    value_preserved_vs_default_usd: o.outcome.financial.value_preserved_vs_default_usd,
  }));
  return b;
}

export function buildSA(policyRow: unknown): Tape {
  const ledger = new LedgerChain(412, fakeHash("ledger-head-before-S-A"));
  const opts = options();
  const thePack = pack();
  const theBrief = brief(opts);
  const briefHash = theBrief.brief_hash;
  const frames: TapeFrame[] = [];
  const extras = { inboxRank: 2, fallbackAt: null as string | null };
  const ctx = { choosable: ["OPT-00000103", "OPT-00000104", "OPT-00000101"] };

  // ---- EVENT: the detection task opens the case unprompted ----------------------------
  const detection = {
    case_id: SA_CASE, decision_point: "D1", episode_key: `${SHIPMENT}#2026-10-06T06:49Z`, shipment_id: SHIPMENT, severity: "HIGH",
    onset_at: at("06:49:00"), holder_party_id_at_onset: "PARTY-SIERRA", holder_type_at_onset: "CARRIER",
    lots: [{ lot_id: "L-A", onset_at: at("06:49:00"), detected_at: at("07:20:00"), breach_min_in_window: 31, max_pulp_c: 3.0, holder_party_id_at_onset: "PARTY-SIERRA" }],
    rule: { detection_window_min: 60, tolerance_min: 30, threshold_c: 1.8, policy_version: "1" },
    run_id: "DET-20261006-0720",
  };
  const view = baseView({
    case_id: SA_CASE, decision_point: "D1", state: "OPEN", state_version: 1, severity: "HIGH",
    episode_key: detection.episode_key, shipment_id: SHIPMENT, onset_at: at("06:49:00"), detected_at: at("07:20:00"),
    opened_at: at("07:20:40"), opened_by: TASK_USER, holder_party_id_at_onset: "PARTY-SIERRA", holder_type_at_onset: "CARRIER",
    policy_version: "1", deadline_ts: null, value_at_risk_usd: null, current_pack_id: null, current_rec_id: null,
    current_brief_hash: null, needs_reassessment: false, provenance: "LIVE", updated_at: at("07:20:40"),
    lots: [{ lot_id: "L-A", added_at: at("07:20:40"), onset_at: at("06:49:00"), detected_at: at("07:20:00"), breach_min_at_detection: 31, max_pulp_c: 3.0, holder_party_id_at_onset: "PARTY-SIERRA" }],
  }, detection);
  const pulp = curve([
    [at("13:00:00", "2026-10-05"), 17.5], [at("15:30:00", "2026-10-05"), 2.6], [at("16:10:00", "2026-10-05"), 1.6],
    [at("18:00:00", "2026-10-05"), 0.9], [at("06:00:00"), 0.8], [at("06:49:00"), 1.8], [at("07:20:00"), 3.0],
  ]);
  const thermalFrom = at("13:00:00", "2026-10-05");
  const holders = [
    { from: thermalFrom, party: "PARTY-EMERALD-RIDGE", type: "PACKHOUSE" as const },
    { from: at("02:00:00"), party: "PARTY-SIERRA", type: "CARRIER" as const },
  ];
  view.analysis.thermal = [thermal({ lotId: "L-A", thresholdC: 1.8, trefC: 0, q10: 3, from: thermalFrom, to: at("07:20:00"), holders, pulp })];
  ledger.append(at("07:20:40"), "CASE_OPENED", SA_CASE, TASK_USER, `BBC_OS.DECISION.CASES#${SA_CASE}`, detection);
  frames.push(frame("Excursion detected: case opened by the detection task", view, ledger, ctx, extras));

  // ---- ANALYSIS: evidence pack sealed, deterministic attribution ------------------------
  transition(view, "ASSESSED", at("07:21:12"));
  view.analysis.pack = thePack;
  view.analysis.packs = [{ pack_id: PACK, decision_point: "D1", revision: 1, as_of: thePack.as_of, sealed_at: thePack.sealed_at, content_hash: thePack.content_hash }];
  view.case.current_pack_id = PACK;
  view.case.value_at_risk_usd = 21355.0;
  view.case.deadline_ts = DEADLINE;
  ledger.append(at("07:21:12"), "ASSESSMENT_SEALED", SA_CASE, ENGINE_USER, `BBC_OS.EVIDENCE.EVIDENCE_PACKS#${PACK}`, { pack_id: PACK, content_hash: thePack.content_hash });
  transition(view, "FINDING_RECORDED", at("07:21:13"));
  view.analysis.findings = [{
    finding_id: FIND, decision_point: "D1", revision: 1, pack_id: PACK, decider_kind: "RULE", run_id: null, status: "ACCEPTED",
    unadjudicated: true, confidence: null, finding: null, finding_hash: null, created_at: at("07:21:13"), created_by: ENGINE_USER,
  }];
  ledger.append(at("07:21:13"), "FINDING", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.CAUSATION_FINDINGS#${FIND}`, { finding_id: FIND, unadjudicated: true, attribution: { "PARTY-SIERRA": 0.82, "PARTY-EMERALD-RIDGE": 0.18 } });
  extras.fallbackAt = DEADLINE;
  view.governance.fallback = { option_id: "OPT-00000103", label: "Inspect at Central Valley DC (safe fallback)", runs_at: DEADLINE };
  frames.push(frame("Evidence pack sealed; deterministic custody attribution recorded", view, ledger, ctx, extras));

  // ---- OPTIONS ----------------------------------------------------------------------------
  transition(view, "OPTIONS_SCORED", at("07:21:38"));
  view.options = opts;
  ledger.append(at("07:21:38"), "OPTIONS_SCORED", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.OPTIONS#${PACK}/1`, { option_ids: opts.map((o) => o.option_id), objective_version: "objective@1" });
  frames.push(frame("Five options scored against doing nothing; expedite eliminated", view, ledger, ctx, extras));

  // ---- DECISION: rule recommendation, no audit needed -------------------------------------
  transition(view, "RECOMMENDED", at("07:21:40"));
  view.case.current_rec_id = REC;
  view.case.current_brief_hash = briefHash;
  view.decision.recommendations = [{
    rec_id: REC, decision_point: "D1", option_id: "OPT-00000102", decided_by: "RULE", decider_id: "R-DISP-03@4", run_id: null,
    escalation_reasons: [], status: "ACTIVE", audit_status: "NOT_REQUIRED", brief: theBrief, brief_hash: briefHash,
    submission: null, audit_verdict: null, audited_text: null, created_at: at("07:21:40"),
  }];
  ledger.append(at("07:21:40"), "RECOMMENDATION", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.RECOMMENDATIONS#${REC}`, { rec_id: REC, option_id: "OPT-00000102", decided_by: "RULE", decider_id: "R-DISP-03@4", brief_hash: briefHash });
  transition(view, "AUDITED", at("07:21:41"));
  ledger.append(at("07:21:41"), "TRANSITION", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SA_CASE}`, { from: "RECOMMENDED", to: "AUDITED", reason: "rule decision: template explanation, audit not required" });
  frames.push(frame("Rule recommendation: re-route to Bayline (no AI involved)", view, ledger, ctx, extras));

  // ---- APPROVAL: policy evaluation requests Sales and Quality ------------------------------
  transition(view, "PENDING_APPROVAL", at("07:22:01"));
  view.governance.evaluations = [{
    eval_id: EVAL, rec_id: REC, policy_version: "1", outcome: "APPROVE", autonomy_level: 4,
    required_roles: ["BBC_QUALITY_MGR", "BBC_SALES_MGR"], dual_approval: true, shadow: false, matched_rules: ["DR-04"],
    value_at_risk_usd: 21355.0,
    reasons: ["DR-04: re-route sells the lot to a different customer for $44,688 (>= $25,000)", "REROUTE is COMPENSATABLE: only REVERSIBLE actions run inside L3"],
    dimensions: [
      { dimension: "financial", metric: "action_value_usd", value: 3952, band: "L3", approver_roles: [] },
      { dimension: "financial", metric: "value_at_risk_usd", value: 21355, band: "L3", approver_roles: [] },
      { dimension: "customer", metric: "tier_a_lines_affected", value: 0, band: "L3", approver_roles: [] },
      { dimension: "inventory", metric: "replacement_share_of_site_atp", value: 0.11, band: "L3", approver_roles: [] },
      { dimension: "operational", metric: "reversibility_rank", value: 1, band: "L4", approver_roles: ["BBC_QUALITY_MGR"] },
      { dimension: "confidence", metric: "confidence_rank", value: 0, band: "L3", approver_roles: [] },
      { dimension: "data_quality", metric: "data_age_min", value: 1, band: "L3", approver_roles: [] },
    ],
    created_at: at("07:22:01"),
  }];
  const approval = (id: string, role: "BBC_SALES_MGR" | "BBC_QUALITY_MGR") => ({
    approval_id: id, eval_id: EVAL, rec_id: REC, required_role: role, status: "REQUESTED" as const, requested_at: at("07:22:01"),
    due_at: DEADLINE, brief_hash_at_request: briefHash, proposer: ENGINE_USER, decided_by: null, decided_role: null,
    decided_at: null, chosen_option_id: null, reason: null, freshness: { brief_fresh: true, pack_fresh: true, checked_at: at("07:22:01") },
  });
  view.governance.approvals = [approval(APR_SALES, "BBC_SALES_MGR"), approval(APR_QUALITY, "BBC_QUALITY_MGR")];
  ledger.append(at("07:22:01"), "POLICY_EVALUATION", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.POLICY_EVALUATIONS#${EVAL}`, { eval_id: EVAL, outcome: "APPROVE", required_roles: ["BBC_QUALITY_MGR", "BBC_SALES_MGR"], approval_ids: [APR_SALES, APR_QUALITY] });
  const pending = frames.push(frame("Awaiting Sales and Quality approval (dual approval, L4)", view, ledger, ctx, extras)) - 1;

  const decide = (v: CaseView, id: string, persona: "sales" | "quality", ts: string) => {
    const a = v.governance.approvals.find((x) => x.approval_id === id)!;
    a.status = "APPROVED";
    a.decided_by = PERSONA_IDS[persona].user;
    a.decided_role = PERSONA_IDS[persona].role;
    a.decided_at = ts;
    a.freshness = { brief_fresh: true, pack_fresh: true, checked_at: ts };
    v.case.state_version += 1;
    v.case.updated_at = ts;
    v.generated_at = ts;
  };

  // Branch: Quality may approve first (frame "Quality approved; awaiting Sales"), built after the main path.
  const qView = clone(view);

  // Linear path: Sales approves first.
  decide(view, APR_SALES, "sales", at("07:41:10"));
  ledger.append(at("07:41:10"), "APPROVAL", SA_CASE, PERSONA_IDS.sales.user, `BBC_OS.DECISION.APPROVALS#${APR_SALES}`, { approval_id: APR_SALES, verdict: "APPROVE", role: "BBC_SALES_MGR", brief_hash: briefHash });
  const salesDone = frames.push(frame("Sales approved; awaiting Quality", view, ledger, ctx, extras)) - 1;

  decide(view, APR_QUALITY, "quality", at("07:48:30"));
  ledger.append(at("07:48:30"), "APPROVAL", SA_CASE, PERSONA_IDS.quality.user, `BBC_OS.DECISION.APPROVALS#${APR_QUALITY}`, { approval_id: APR_QUALITY, verdict: "APPROVE", role: "BBC_QUALITY_MGR", brief_hash: briefHash });

  // ---- EXECUTION: the gateway queues the plan; the dispatcher applies it ------------------
  transition(view, "APPROVED", at("07:48:30"));
  transition(view, "EXECUTING", at("07:48:31"));
  extras.fallbackAt = null;
  view.governance.fallback = null;
  const approvers = [
    { user: PERSONA_IDS.sales.user, role: "BBC_SALES_MGR", approval_id: APR_SALES },
    { user: PERSONA_IDS.quality.user, role: "BBC_QUALITY_MGR", approval_id: APR_QUALITY },
  ];
  const common = {
    planId: PLAN, caseId: SA_CASE, decisionPoint: "D1" as const, recId: REC, optionId: "OPT-00000102", briefHash, packId: PACK,
    evalId: EVAL, decider: { kind: "RULE" as const, id: "R-DISP-03@4" }, proposedAt: at("07:22:00"),
  };
  const muts = [
    mutation({ ...common, mutationId: "MUT-00000300", stepSeq: 1, actionType: "REPLACEMENT_ALLOCATION", targetSystem: "SAP",
      target: { type: "SALES_ORDER_ITEM", id: "SO-6001-10" }, payload: { order_line_id: "SO-6001-10", replacement_lot_id: "L-CV-0912", from_site_id: "SITE-CVDC-TRACY", kg: 4200 },
      expectedBefore: { assigned_lot_id: "L-A" }, expectedAfter: { assigned_lot_id: "L-CV-0912" }, approvalIds: [APR_SALES, APR_QUALITY], autonomyLevel: 4, approvers }),
    mutation({ ...common, mutationId: "MUT-00000301", stepSeq: 2, actionType: "REROUTE", targetSystem: "TMS",
      target: { type: "SHIPMENT", id: SHIPMENT }, payload: { shipment_id: SHIPMENT, lot_id: "L-A", new_destination_site_id: "SITE-BAYLINE-SAC", disposition: "REROUTE" },
      expectedBefore: { status: "IN_TRANSIT", destination_site_id: "SITE-SUMMIT-SLC" }, expectedAfter: { destination_site_id: "SITE-BAYLINE-SAC" },
      approvalIds: [APR_SALES, APR_QUALITY], autonomyLevel: 4, approvers }),
    mutation({ ...common, mutationId: "MUT-00000302", stepSeq: 3, actionType: "SO_CREATE", targetSystem: "SAP",
      target: { type: "CUSTOMER", id: "PARTY-BAYLINE" }, payload: { ship_to_site_id: "SITE-BAYLINE-SAC", lot_id: "L-A", kg: 4200, price_usd_per_kg: 10.64 },
      expectedBefore: {}, expectedAfter: { lot_id: "L-A", kg: 4200 }, approvalIds: [APR_SALES, APR_QUALITY], autonomyLevel: 4, approvers }),
    mutation({ ...common, mutationId: "MUT-00000303", stepSeq: 4, actionType: "CLAIM_NOTICE", targetSystem: "CARRIER",
      target: { type: "CLAIM", id: `${SA_CASE}:PARTY-SIERRA` }, payload: { counterparty_party_id: "PARTY-SIERRA", basis: "CARRIER_TEMPERATURE", shipment_id: SHIPMENT },
      expectedBefore: { notice_on_file: false }, expectedAfter: { notice_on_file: true }, approvalIds: [], autonomyLevel: 3, approvers: [] }),
  ];
  for (const m of muts) {
    const stamps = m.record!.timestamps as Record<string, string | null>;
    stamps["evaluated_at"] = at("07:22:01");
    stamps["approved_at"] = m.intent.action_type === "CLAIM_NOTICE" ? null : at("07:48:30");
    advanceMutation(m, "AUTHORIZED", at("07:48:31"));
  }
  view.execution.plans = [{
    plan_id: PLAN, rec_id: REC, atomicity: "ALL_OR_NOTHING", status: "EXECUTING",
    steps: muts.map((m) => ({ step_seq: m.step_seq!, action_type: m.action_type, target_system: m.target_system, mutation_id: m.mutation_id })),
    created_at: at("07:48:31"), updated_at: at("07:48:31"),
  }];
  view.execution.mutations = muts;
  ledger.append(at("07:48:31"), "TRANSITION", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SA_CASE}`, { from: "APPROVED", to: "EXECUTING", plan_id: PLAN });
  for (const m of muts) ledger.append(at("07:48:31"), "ACTION_QUEUED", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#${m.mutation_id}`, { mutation_id: m.mutation_id, action_type: m.action_type, idempotency_key: m.intent.idempotency_key });
  advanceMutation(muts[0]!, "DISPATCHED", at("07:48:33"));
  advanceMutation(muts[0]!, "ACKED", at("07:48:34"), { externalRef: "SAP-ALLOC-55120" });
  advanceMutation(muts[0]!, "VERIFIED", at("07:48:35"));
  ledger.append(at("07:48:35"), "ACTION_ACKED", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#MUT-00000300`, { mutation_id: "MUT-00000300", status: "VERIFIED", external_ref: "SAP-ALLOC-55120" });
  advanceMutation(muts[1]!, "DISPATCHED", at("07:48:36"));
  view.case.updated_at = at("07:48:36");
  view.generated_at = at("07:48:36");
  const executing = frames.push(frame("Approved: the gateway is executing the plan", view, ledger, ctx, extras)) - 1;

  advanceMutation(muts[1]!, "ACKED", at("07:48:39"), { externalRef: "TMS-RR-88213" });
  advanceMutation(muts[1]!, "VERIFIED", at("07:48:41"));
  advanceMutation(muts[2]!, "DISPATCHED", at("07:48:42"));
  advanceMutation(muts[2]!, "ACKED", at("07:48:44"), { externalRef: "SAP-SO-7001" });
  advanceMutation(muts[2]!, "VERIFIED", at("07:48:45"));
  advanceMutation(muts[3]!, "DISPATCHED", at("07:48:46"));
  advanceMutation(muts[3]!, "ACKED", at("07:48:47"), { externalRef: "SIERRA-CN-20261006-01" });
  advanceMutation(muts[3]!, "VERIFIED", at("07:48:48"));
  for (const [id, ref] of [["MUT-00000301", "TMS-RR-88213"], ["MUT-00000302", "SAP-SO-7001"], ["MUT-00000303", "SIERRA-CN-20261006-01"]] as const) {
    ledger.append(at("07:48:48"), "ACTION_ACKED", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#${id}`, { mutation_id: id, status: "VERIFIED", external_ref: ref });
  }
  view.execution.plans[0]!.status = "DONE";
  view.execution.plans[0]!.updated_at = at("07:48:48");
  view.outcome.claims = [{
    claim_id: CLAIM, counterparty_party_id: "PARTY-SIERRA", basis: "CARRIER_TEMPERATURE", status: "NOTICE_SENT", amount_usd: null,
    paid_usd: null, notice_sent_at: at("07:48:47"), filed_at: null, filing_due_at: at("07:48:47", "2027-07-03"),
    variant_option_id: null, evidence_pack_id: PACK, updated_at: at("07:48:47"),
  }];
  ledger.append(at("07:48:49"), "CLAIM_UPDATE", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.CLAIMS#${CLAIM}`, { claim_id: CLAIM, status: "NOTICE_SENT" });
  transition(view, "EXECUTED", at("07:48:50"));
  ledger.append(at("07:48:50"), "TRANSITION", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SA_CASE}`, { from: "EXECUTING", to: "EXECUTED" });
  transition(view, "AWAITING_OUTCOME", at("07:48:51"));
  ledger.append(at("07:48:51"), "TRANSITION", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SA_CASE}`, { from: "EXECUTED", to: "AWAITING_OUTCOME" });
  frames.push(frame("Executed in SAP, TMS and with the carrier; awaiting receipt QC", view, ledger, { ...ctx, reversers: ["quality"] }, extras));

  // ---- OUTCOME: receipt QC at Bayline ------------------------------------------------------
  transition(view, "OUTCOME_RECORDED", at("14:32:00"));
  view.outcome.lots = [{
    lot_id: "L-A", outcome_status: "OBSERVED", accepted_at_receipt: true, realized_nrv_usd: 44620.0, predicted_nrv_usd: 45301.0,
    default_nrv_usd: 24300.0, value_protected_expost_usd: 20320.0, sl_prediction_error_days: 0.3,
    observed: { receipt_qc_at: at("14:05:00"), arrival_pulp_c: 3.9, shelf_life_days_at_receipt: 8.45, accepted_kg: 4200, sale_value_usd: 44688.0 },
    predicted: { option_id: "OPT-00000102", sl_at_arrival_days_p50: 8.75, p_accept: 0.999, expected_nrv_usd: 45301.0 },
    computed_at: at("14:32:00"),
  }];
  ledger.append(at("14:32:00"), "OUTCOME", SA_CASE, ENGINE_USER, `BBC_OS.DECISION.OUTCOMES#${SA_CASE}/L-A`, { lot_id: "L-A", realized_nrv_usd: 44620.0, default_nrv_usd: 24300.0 });
  frames.push(frame("Outcome recorded: accepted at Bayline; $20,320 protected vs doing nothing (ex-post)", view, ledger, ctx, extras));

  // ---- Branch frame: Quality approves first -------------------------------------------------
  // The branch shares the ledger up to POLICY_EVALUATION and diverges after it.
  const branchLedger = new LedgerChain(412, fakeHash("ledger-head-before-S-A"));
  for (const e of ledger.entries.filter((x) => x.seq <= frames[pending]!.cases[SA_CASE]!.view.evidence.ledger.last_seq!)) {
    branchLedger.append(e.ts, e.entry_type, SA_CASE, e.actor, e.record_ref, ledger.payloadOf.get(e.seq));
  }
  decide(qView, APR_QUALITY, "quality", at("07:39:05"));
  branchLedger.append(at("07:39:05"), "APPROVAL", SA_CASE, PERSONA_IDS.quality.user, `BBC_OS.DECISION.APPROVALS#${APR_QUALITY}`, { approval_id: APR_QUALITY, verdict: "APPROVE", role: "BBC_QUALITY_MGR", brief_hash: briefHash });
  const qualityFirst = frames.push(frame("Quality approved; awaiting Sales", qView, branchLedger, ctx, { inboxRank: 2, fallbackAt: DEADLINE })) - 1;

  const approved = (id: string, remaining: string[], seq: number) => ({
    status: "OK", approval_id: id, approval_status: "APPROVED", ledger_seq: seq, case_state: remaining.length ? "PENDING_APPROVAL" : "APPROVED",
  });
  const v = (i: number) => frames[i]!.cases[SA_CASE]!.view;
  const responses: TapeResponse[] = [
    { call: "DECIDE_APPROVAL", persona: "sales", at_frames: [pending], match: { approval_id: APR_SALES, verdict: "APPROVE" },
      result: approved(APR_SALES, [APR_QUALITY], v(salesDone).evidence.ledger.last_seq!),
      advance_to_frame: salesDone },
    { call: "DECIDE_APPROVAL", persona: "quality", at_frames: [salesDone], match: { approval_id: APR_QUALITY, verdict: "APPROVE" },
      result: approved(APR_QUALITY, [], v(salesDone).evidence.ledger.last_seq! + 1),
      advance_to_frame: executing },
    { call: "DECIDE_APPROVAL", persona: "quality", at_frames: [pending], match: { approval_id: APR_QUALITY, verdict: "APPROVE" },
      result: approved(APR_QUALITY, [APR_SALES], v(qualityFirst).evidence.ledger.last_seq!),
      advance_to_frame: qualityFirst },
    { call: "DECIDE_APPROVAL", persona: "sales", at_frames: [qualityFirst], match: { approval_id: APR_SALES, verdict: "APPROVE" },
      result: approved(APR_SALES, [], v(salesDone).evidence.ledger.last_seq! + 1),
      advance_to_frame: executing },
    // Deciding an approval that is no longer REQUESTED replays its status and changes nothing.
    { call: "DECIDE_APPROVAL", persona: "sales", at_frames: [salesDone], match: { approval_id: APR_SALES },
      result: { status: "OK", approval_id: APR_SALES, approval_status: "APPROVED", replayed: true },
      advance_to_frame: null },
    { call: "REVERSE_DECISION", persona: "quality", at_frames: [executing + 1], match: { rec_id: REC },
      result: { status: "DENIED", errors: ["REROUTE_BACK precondition junction_not_passed failed: SHP-20261006-114 passed SITE-JCT-I80-SAC at 07:58"], code: "PRECONDITION_FAILED" },
      advance_to_frame: null },
  ];

  const proofs = proofResponses(frames, SA_CASE, ledger, 416, policyRow);
  return {
    tape: "S-A",
    title: "S-A: reefer failure, rule-decided re-route, dual approval",
    provenance: "SYNTHETIC (design numbers)",
    description:
      "A compressor fault on Sierra Cold Freight's trailer warms a tier-A organic lot. Detection opens the case unprompted; the engine " +
      "scores five options against doing nothing; a rule decides the re-route to Bayline (no AI). Policy v1 requires Sales and Quality; " +
      "the gateway then writes to SAP, the TMS and the carrier. Numbers are the design's illustrative worked example.",
    personas: PERSONA_IDS,
    frames: frames as Tape["frames"],
    responses: [...responses, ...proofs],
    analyst: [
      {
        question: "Which lots have less than 10 days of shelf life left?",
        answer: {
          question: "Which lots have less than 10 days of shelf life left?",
          semantic_view: "BBC_OS.SEM.EXCURSION_RECOVERY",
          interpretation: "Lots whose remaining shelf life, as of their last reading, is below 10 days.",
          sql: "SELECT * FROM SEMANTIC_VIEW(BBC_OS.SEM.EXCURSION_RECOVERY DIMENSIONS lots.lot_id, products.variety METRICS lot_thermal.remaining_shelf_life_days) WHERE remaining_shelf_life_days < 10 ORDER BY remaining_shelf_life_days",
          executed_as: { user: PERSONA_IDS.quality.user, role: "BBC_QUALITY_MGR" },
          columns: [{ name: "LOT_ID", type: "text" }, { name: "VARIETY", type: "text" }, { name: "REMAINING_SHELF_LIFE_DAYS", type: "fixed" }],
          rows: [["L-B", "Duke", 7.4], ["L-A", "Emerald", 9.0]],
          row_count: 2, truncated: false, request_id: "fixture-an-01", warnings: [], suggestions: ["Which carriers held lots during breaches today?"],
          executed_at: at("07:30:00"),
        },
      },
      {
        question: "What share of excess shelf-life loss did each holder cause on lot L-A?",
        answer: {
          question: "What share of excess shelf-life loss did each holder cause on lot L-A?",
          semantic_view: "BBC_OS.SEM.EXCURSION_RECOVERY",
          interpretation: "For lot L-A, each custody holder's share of the lot's attributable excess shelf-life loss.",
          sql: "SELECT * FROM SEMANTIC_VIEW(BBC_OS.SEM.EXCURSION_RECOVERY DIMENSIONS holders.holder_name, holders.holder_type METRICS custody_exposure.excess_life_share, custody_exposure.thermal_exposure_deg_h) WHERE lot_id = 'L-A'",
          executed_as: { user: PERSONA_IDS.quality.user, role: "BBC_QUALITY_MGR" },
          columns: [{ name: "HOLDER_NAME", type: "text" }, { name: "HOLDER_TYPE", type: "text" }, { name: "EXCESS_LIFE_SHARE", type: "fixed" }, { name: "THERMAL_EXPOSURE_DEG_H", type: "fixed" }],
          rows: [["Sierra Cold Freight", "CARRIER", 0.82, 22.8], ["Emerald Ridge Farms", "PACKHOUSE", 0.18, 4.9]],
          row_count: 2, truncated: false, request_id: "fixture-an-02", warnings: [], suggestions: [],
          executed_at: at("07:31:00"),
        },
      },
    ],
    agent_traces: {},
  };
}
