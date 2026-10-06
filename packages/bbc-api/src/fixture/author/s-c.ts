/**
 * Tape S-C (docs/demo/scenarios.md): D2 settlement with a carrier defense. An earlier
 * reefer-failure case has its outcome; Claims & Recovery builds the carrier claim from the
 * deterministic loss basis, the Auditor passes it, Finance approves filing (DR-06, DR-09).
 * The carrier answers "shipper loaded warm product" with an 80% offer; the agent rebuts
 * from the causal signatures and recommends accepting (inside the policy's 60-100% band);
 * Finance approves; the claim settles and the case is sealed.
 */

import {
  ENGINE_USER,
  LedgerChain,
  PERSONA_IDS,
  advanceMutation,
  at,
  baseView,
  clone,
  fakeHash,
  fixture,
  frame,
  mutation,
  proofResponses,
  transition,
  type CaseView,
  type Option,
  type Tape,
  type TapeFrame,
  type TapeResponse,
} from "./kit.js";

export const SC_CASE = "CASE-00000011";
const SHIPMENT = "SHP-20261003-077";
const PACK_D1 = "PACK-00000026";
const PACK_D2 = "PACK-00000051";
const REC_FILE = "REC-00000061";
const REC_ACCEPT = "REC-00000062";
const EVAL_FILE = "EVAL-00000066";
const EVAL_ACCEPT = "EVAL-00000067";
const APR_FILE = "APR-00000080";
const APR_ACCEPT = "APR-00000081";
const CLAIM = "CLM-00000066";
const PLAN = "PLAN-00000019";
const RUN_C1 = "RUN-00000220";
const RUN_A1 = "RUN-00000221";
const RUN_C2 = "RUN-00000222";
const DAY = "2026-10-06";
const CLAIM_USD = 21355.0;
const OFFER_USD = 17084.0;

type Pack = NonNullable<CaseView["analysis"]["pack"]>;
type Brief = NonNullable<CaseView["decision"]["recommendations"][number]["brief"]>;
type Run = CaseView["agents"]["runs"][number];
type ClaimRec = Extract<NonNullable<CaseView["decision"]["recommendations"][number]["submission"]>, { action: unknown }>;

function pack(): Pack {
  const p = fixture<Pack>("evidence_pack");
  Object.assign(p, { pack_id: PACK_D2, case_id: SC_CASE, decision_point: "D2", revision: 1, as_of: at("09:00:00", DAY), sealed_at: at("09:00:09", DAY), content_hash: fakeHash("pack-S-C-D2") });
  p.shipment = { ...p.shipment, shipment_id: SHIPMENT, state_at_as_of: "DELIVERED", evidence_id: `EV:PACK:${PACK_D2}#/shipment` };
  p.lots = p.lots.map((l) => ({ ...l, lot_id: "L-C", values: l.values.map((v, i) => ({ ...v, evidence_id: `EV:PACK:${PACK_D2}#/lots/0/values/${i}` })),
    custody_exposure: l.custody_exposure.map((c, i) => ({ ...c, evidence_id: `EV:PACK:${PACK_D2}#/lots/0/custody_exposure/${i}` })) })) as Pack["lots"];
  p.custody_timeline = p.custody_timeline.map((c, i) => ({ ...c, evidence_id: `EV:PACK:${PACK_D2}#/custody_timeline/${i}` }));
  p.affected_order_lines = [];
  p.candidate_inventory = [];
  p.candidate_destinations = [];
  p.inspection_sites = [];
  p.deadline_inputs = { windows: [] };
  return p;
}

function claimOption(id: string, label: string, action: "FILE_CLAIM" | "ABSORB" | "ACCEPT_OFFER", variant: "FULL" | "SETTLEMENT" | null, amount: number | null, recovery: number, rank: number): Option {
  const o = fixture<Option>("option", 1);
  Object.assign(o, {
    option_id: id, case_id: SC_CASE, decision_point: "D2", label, is_default: action === "ABSORB", is_fallback: false, feasible: true, flags: [],
    eliminations: [], expires_at: at("23:59:00", "2027-06-30"), evidence_id: `EV:OPT:${id}`,
    bundle: { lots: [], order_recovery: [], financial: [{ action, counterparty_party_id: "PARTY-SIERRA", basis: "CARRIER_TEMPERATURE", amount_usd: amount, variant }] },
  });
  o.outcome = {
    ...o.outcome,
    operational: { p_accept: 1, kg_delivered_expected: 0 },
    financial: { expected_revenue_usd: 0, costs: {}, expected_penalties_usd: 0, expected_recovery_usd: recovery, expected_nrv_usd: recovery,
      nrv_p10_usd: Math.round(recovery * 0.6), nrv_p90_usd: amount ?? 0, expected_loss_usd: CLAIM_USD - recovery, value_preserved_vs_default_usd: recovery },
    risk: { p_reject: 0, food_safety_flag: false },
    customer: { lines_affected: 0, tier_a_shortfall_kg: 0 },
    logistics: {}, inventory: {}, recovery_cost_usd: action === "FILE_CLAIM" ? 450 : 0,
    confidence: { level: "HIGH", drivers: ["custody proven by probe and TMS events", "setpoint on the BOL"] },
  };
  o.score = { risk_adjusted_usd: Math.round(recovery * 0.92), rank, dominated_by: [], objective_version: "objective@1" };
  o.provenance = { ...o.provenance, pack_id: PACK_D2, seed: 610000 + rank, inputs_hash: fakeHash("inputs-S-C") };
  return o;
}

function briefFor(rec: string, chosen: Option, all: Option[], generatedAt: string, narrative: string, hashLabel: string): Brief {
  const b = fixture<Brief>("brief");
  const absorb = all.find((o) => o.is_default)!;
  Object.assign(b, {
    case_id: SC_CASE, decision_point: "D2", pack_id: PACK_D2, brief_hash: fakeHash(hashLabel), generated_at: generatedAt,
    do_nothing: { option_id: absorb.option_id, outcome: clone(absorb.outcome) },
    options: all.filter((o) => !o.is_default).map((o) => ({ option_id: o.option_id, label: o.label, outcome: clone(o.outcome), flags: [], expires_at: o.expires_at })),
    value_table: all.map((o) => ({ option_id: o.option_id, expected_nrv_usd: o.outcome.financial.expected_nrv_usd, nrv_p10_usd: o.outcome.financial.nrv_p10_usd,
      nrv_p90_usd: o.outcome.financial.nrv_p90_usd, value_preserved_vs_default_usd: o.outcome.financial.value_preserved_vs_default_usd })),
    eliminated: [],
    comparison: { ranking: all.map((o) => o.option_id), non_dominated: [chosen.option_id], margin_top2_usd: 1800.0, objective_version: "objective@1",
      escalation_reasons: ["QUALITATIVE_SIGNAL"], p_liab_attribution_only: 0.82, p_liab_with_finding: 0.9 },
    precedents: [{ case_id: "CASE-00000004", similarity: 0.87, action_kind: "FILE_CLAIM", decider_kind: "AGENT", value_protected_expost_usd: 15100.0,
      sl_prediction_error_days: 0.2, evidence_id: "EV:PREC:CASE-00000004" }],
    recommendation: { option_id: chosen.option_id, rec_id: rec, decided_by: "AGENT", decider_id: "CLAIMS_RECOVERY@1", why_structured: ["PREREQUISITES_MET", "WITHIN_POLICY_BAND"], narrative },
  });
  return b;
}

function agentRun(runId: string, agent: Run["agent"], model: string, startedAt: string, endedAt: string | null, tools: string[]): Run {
  return {
    run_id: runId, decision_point: "D2", agent, provider: "cortex-agent", model, spec_version: "1", status: endedAt ? "COMPLETED" : "STARTED",
    call_budget: 10, calls_used: endedAt ? tools.length : 0, started_at: startedAt, ended_at: endedAt,
    latency_ms: endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null,
    trace: endedAt
      ? [
          { run_id: runId, seq: 0, at: startedAt, kind: "STATUS", text: "Planning" },
          ...tools.map((t, i) => ({ run_id: runId, seq: i + 1, at: startedAt, kind: "TOOL_USE" as const, tool: { name: t, tool_use_id: `tu_${i + 1}` } })),
          { run_id: runId, seq: tools.length + 1, at: endedAt, kind: "DONE" },
        ]
      : [],
    trace_truncated: false,
    tool_calls: endedAt
      ? tools.map((t, i) => ({ call_seq: i + 1, tool: t, status: t.startsWith("SUBMIT_") ? "ACCEPTED" : "OK", latency_ms: 800, evidence_ids: [],
          args_hash: fakeHash(`${runId}-a${i}`), result_hash: fakeHash(`${runId}-r${i}`), called_at: startedAt }))
      : [],
  };
}

export function buildSC(policyRow: unknown): Tape {
  const ledger = new LedgerChain(300, fakeHash("ledger-head-before-S-C"));
  const thePack = pack();
  const full = claimOption("OPT-00000210", "File the full claim against Sierra Cold Freight ($21,355)", "FILE_CLAIM", "FULL", CLAIM_USD, 17500, 1);
  const absorb = claimOption("OPT-00000212", "Absorb the loss", "ABSORB", null, null, 0, 3);
  const settle = claimOption("OPT-00000214", "Accept Sierra's offer of $17,084 (80%)", "ACCEPT_OFFER", "SETTLEMENT", OFFER_USD, OFFER_USD, 1);
  const frames: TapeFrame[] = [];
  const extras = { inboxRank: 3, fallbackAt: null as string | null };
  const ctx = { choosable: [] as string[] };

  const detection = {
    case_id: SC_CASE, decision_point: "D1", episode_key: `${SHIPMENT}#2026-10-03T21:10Z`, shipment_id: SHIPMENT, severity: "HIGH",
    onset_at: at("21:10:00", "2026-10-03"), holder_party_id_at_onset: "PARTY-SIERRA", holder_type_at_onset: "CARRIER",
    lots: [{ lot_id: "L-C", onset_at: at("21:10:00", "2026-10-03"), detected_at: at("21:41:00", "2026-10-03"), breach_min_in_window: 31, max_pulp_c: 5.1, holder_party_id_at_onset: "PARTY-SIERRA" }],
    rule: { detection_window_min: 60, tolerance_min: 30, threshold_c: 1.8, policy_version: "1" },
    run_id: "DET-20261003-2141",
  };
  const view = baseView({
    case_id: SC_CASE, decision_point: "D2", state: "OUTCOME_RECORDED", state_version: 24, severity: "HIGH", episode_key: detection.episode_key,
    shipment_id: SHIPMENT, onset_at: detection.onset_at, detected_at: at("21:41:00", "2026-10-03"), opened_at: at("21:41:40", "2026-10-03"),
    opened_by: "SYSTEM", holder_party_id_at_onset: "PARTY-SIERRA", holder_type_at_onset: "CARRIER", policy_version: "1",
    deadline_ts: at("23:59:00", "2027-06-30"), value_at_risk_usd: CLAIM_USD, current_pack_id: PACK_D2, current_rec_id: null, current_brief_hash: null,
    needs_reassessment: false, provenance: "LIVE", updated_at: at("09:00:00", DAY),
    lots: [{ lot_id: "L-C", added_at: at("21:41:40", "2026-10-03"), onset_at: detection.onset_at, detected_at: at("21:41:00", "2026-10-03"),
      breach_min_at_detection: 31, max_pulp_c: 5.1, holder_party_id_at_onset: "PARTY-SIERRA" }],
  }, detection);
  view.analysis.pack = thePack;
  view.analysis.packs = [
    { pack_id: PACK_D1, decision_point: "D1", revision: 1, as_of: at("21:42:00", "2026-10-03"), sealed_at: at("21:42:11", "2026-10-03"), content_hash: fakeHash("pack-S-C-D1") },
    { pack_id: PACK_D2, decision_point: "D2", revision: 1, as_of: thePack.as_of, sealed_at: thePack.sealed_at, content_hash: thePack.content_hash },
  ];
  view.outcome.lots = [{
    lot_id: "L-C", outcome_status: "OBSERVED", accepted_at_receipt: true, realized_nrv_usd: 25685.0, predicted_nrv_usd: 26185.0, default_nrv_usd: 19900.0,
    value_protected_expost_usd: 5785.0, sl_prediction_error_days: -0.4,
    observed: { receipt_qc_at: at("08:10:00", "2026-10-04"), accepted_kg: 4200, sale_value_usd: 14700.0, channel: "PROCESSOR" },
    predicted: { option_id: "OPT-00000184", expected_nrv_usd: 26185.0 }, computed_at: at("09:40:00", "2026-10-04"),
  }];
  view.outcome.claims = [{ claim_id: CLAIM, counterparty_party_id: "PARTY-SIERRA", basis: "CARRIER_TEMPERATURE", status: "NOTICE_SENT", amount_usd: null, paid_usd: null,
    notice_sent_at: at("22:02:00", "2026-10-03"), filed_at: null, filing_due_at: at("23:59:00", "2027-06-30"), variant_option_id: null, evidence_pack_id: PACK_D1,
    updated_at: at("22:02:00", "2026-10-03") }];
  ledger.append(at("21:41:40", "2026-10-03"), "CASE_OPENED", SC_CASE, "SYSTEM", `BBC_OS.DECISION.CASES#${SC_CASE}`, detection);
  ledger.append(at("09:40:00", "2026-10-04"), "OUTCOME", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.OUTCOMES#${SC_CASE}/L-C`, { lot_id: "L-C", realized_nrv_usd: 25685.0 });

  // ---- D2 starts: settlement pack sealed; Claims & Recovery builds the claim ----------------
  transition(view, "ASSESSED", at("09:00:09", DAY));
  ledger.append(at("09:00:09", DAY), "ASSESSMENT_SEALED", SC_CASE, ENGINE_USER, `BBC_OS.EVIDENCE.EVIDENCE_PACKS#${PACK_D2}`, { pack_id: PACK_D2, decision_point: "D2" });
  transition(view, "OPTIONS_SCORED", at("09:00:30", DAY));
  view.options = [full, absorb];
  ledger.append(at("09:00:30", DAY), "OPTIONS_SCORED", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.OPTIONS#${PACK_D2}/1`, { option_ids: [full.option_id, absorb.option_id] });
  transition(view, "CLAIMS_PENDING", at("09:00:31", DAY));
  view.agents.runs = [agentRun(RUN_C1, "CLAIMS_RECOVERY", "claude-sonnet-4-5", at("09:00:40", DAY), null, [])];
  ledger.append(at("09:00:40", DAY), "AGENT_RUN", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.AGENT_RUNS#${RUN_C1}`, { run_id: RUN_C1, status: "STARTED" });
  frames.push(frame("D2 settlement: Claims & Recovery is building the carrier claim", view, ledger, ctx, extras));

  // ---- Claim recommendation, audited, awaiting Finance ------------------------------------------
  const fileNarrative = "File the full $21,355 claim against Sierra Cold Freight. Custody, the BOL setpoint and timely notice are evidenced.";
  const briefFile = briefFor(REC_FILE, full, [full, absorb], at("09:02:10", DAY), fileNarrative, "brief-S-C-file");
  const fileRec = fixture<ClaimRec>("claim_recommendation", 0);
  Object.assign(fileRec, {
    variant_option_id: full.option_id,
    letter_draft: `Sierra Cold Freight - claim for temperature damage to shipment ${SHIPMENT}: $21,355.00 under the carriage contract's temperature clause.`,
    citations: [`EV:LOSS:${SC_CASE}`, "EV:SIG:WARM_LOADING@1"],
  });
  view.agents.runs = [
    agentRun(RUN_C1, "CLAIMS_RECOVERY", "claude-sonnet-4-5", at("09:00:40", DAY), at("09:02:08", DAY), ["GET_CASE_CONTEXT", "COMPUTE_CLAIM_BASIS", "SIMULATE_CLAIM_VARIANTS", "SUBMIT_CLAIM_RECOMMENDATION"]),
    agentRun(RUN_A1, "EVIDENCE_AUDITOR", "mistral-large2", at("09:02:15", DAY), at("09:02:40", DAY), ["GET_ARTIFACT_FOR_AUDIT", "SUBMIT_AUDIT_VERDICT"]),
  ];
  transition(view, "RECOMMENDED", at("09:02:10", DAY));
  view.case.current_rec_id = REC_FILE;
  view.case.current_brief_hash = briefFile.brief_hash;
  const firstSentence = "File the full $21,355 claim against Sierra Cold Freight.";
  view.decision.recommendations = [{
    rec_id: REC_FILE, decision_point: "D2", option_id: full.option_id, decided_by: "AGENT", decider_id: "CLAIMS_RECOVERY@1", run_id: RUN_C1,
    escalation_reasons: ["QUALITATIVE_SIGNAL"], status: "ACTIVE", audit_status: "PASS", brief: briefFile, brief_hash: briefFile.brief_hash, submission: fileRec,
    audit_verdict: { statements: [
      { span: { start: 0, end: Array.from(firstSentence).length }, statement: firstSentence, verdict: "SUPPORTED", evidence_ids: [`EV:OPT:${full.option_id}`] },
      { span: { start: Array.from(firstSentence).length + 1, end: Array.from(fileNarrative).length }, statement: "Custody, the BOL setpoint and timely notice are evidenced.", verdict: "SUPPORTED", evidence_ids: ["EV:SIG:WARM_LOADING@1"] },
    ], overall: "PASS", required_fixes: [] },
    audited_text: fileNarrative, created_at: at("09:02:10", DAY),
  }];
  ledger.append(at("09:02:10", DAY), "RECOMMENDATION", SC_CASE, "BBC_AGENT_SVC", `BBC_OS.DECISION.RECOMMENDATIONS#${REC_FILE}`, { rec_id: REC_FILE, action: "FILE_CLAIM", amount_usd: CLAIM_USD });
  ledger.append(at("09:02:40", DAY), "AUDIT_VERDICT", SC_CASE, "BBC_AGENT_SVC", `BBC_OS.DECISION.RECOMMENDATIONS#${REC_FILE}`, { rec_id: REC_FILE, overall: "PASS" });
  transition(view, "AUDITED", at("09:02:40", DAY));
  transition(view, "PENDING_APPROVAL", at("09:02:41", DAY));
  const evaluation = (id: string, rec: string, ts: string, value: number): CaseView["governance"]["evaluations"][number] => ({
    eval_id: id, rec_id: rec, policy_version: "1", outcome: "APPROVE", autonomy_level: 4, required_roles: ["BBC_FINANCE_MGR"], dual_approval: false,
    shadow: false, matched_rules: ["DR-06", "DR-09"], value_at_risk_usd: CLAIM_USD,
    reasons: ["DR-09: an AI-chosen settlement above $10,000 never self-executes", "DR-06: claims are an external legal step"],
    dimensions: [{ dimension: "financial", metric: "action_value_usd", value, band: "L4", approver_roles: ["BBC_FINANCE_MGR"] }], created_at: ts,
  });
  const approval = (id: string, evalId: string, rec: string, ts: string, hash: string): CaseView["governance"]["approvals"][number] => ({
    approval_id: id, eval_id: evalId, rec_id: rec, required_role: "BBC_FINANCE_MGR", status: "REQUESTED", requested_at: ts, due_at: at("17:00:00", "2026-10-09"),
    brief_hash_at_request: hash, proposer: "BBC_AGENT_SVC", decided_by: null, decided_role: null, decided_at: null, chosen_option_id: null, reason: null,
    freshness: { brief_fresh: true, pack_fresh: true, checked_at: ts },
  });
  view.governance.evaluations = [evaluation(EVAL_FILE, REC_FILE, at("09:02:41", DAY), CLAIM_USD)];
  view.governance.approvals = [approval(APR_FILE, EVAL_FILE, REC_FILE, at("09:02:41", DAY), briefFile.brief_hash)];
  ledger.append(at("09:02:41", DAY), "POLICY_EVALUATION", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.POLICY_EVALUATIONS#${EVAL_FILE}`, { eval_id: EVAL_FILE, outcome: "APPROVE", required_roles: ["BBC_FINANCE_MGR"] });
  const pendingFile = frames.push(frame("Claim recommended and audited: awaiting Finance (DR-06, DR-09)", view, ledger, ctx, extras)) - 1;

  // ---- Finance approves filing; the gateway files with the carrier -------------------------------
  const decide = (id: string, ts: string) => {
    Object.assign(view.governance.approvals.find((a) => a.approval_id === id)!, { status: "APPROVED", decided_by: PERSONA_IDS.finance.user,
      decided_role: "BBC_FINANCE_MGR", decided_at: ts, freshness: { brief_fresh: true, pack_fresh: true, checked_at: ts } });
    ledger.append(ts, "APPROVAL", SC_CASE, PERSONA_IDS.finance.user, `BBC_OS.DECISION.APPROVALS#${id}`, { approval_id: id, verdict: "APPROVE", role: "BBC_FINANCE_MGR" });
  };
  decide(APR_FILE, at("09:31:00", DAY));
  transition(view, "APPROVED", at("09:31:00", DAY));
  transition(view, "EXECUTING", at("09:31:01", DAY));
  const fileMut = mutation({
    mutationId: "MUT-00000340", planId: PLAN, stepSeq: 1, actionType: "FILE_CLAIM", targetSystem: "CARRIER", target: { type: "CLAIM", id: CLAIM },
    payload: { carrier_party_id: "PARTY-SIERRA", amount_usd: CLAIM_USD, basis: "CARRIER_TEMPERATURE", letter_ref: `${REC_FILE}#letter_draft` },
    expectedBefore: { claim_status: "NOTICE_SENT" }, expectedAfter: { claim_status: "FILED" }, caseId: SC_CASE, decisionPoint: "D2", recId: REC_FILE,
    optionId: full.option_id, briefHash: briefFile.brief_hash, packId: PACK_D2, evalId: EVAL_FILE, approvalIds: [APR_FILE], autonomyLevel: 4,
    decider: { kind: "AGENT", id: "CLAIMS_RECOVERY@1", runId: RUN_C1, model: "claude-sonnet-4-5", spec: "1" },
    approvers: [{ user: PERSONA_IDS.finance.user, role: "BBC_FINANCE_MGR", approval_id: APR_FILE }], proposedAt: at("09:02:40", DAY),
  });
  const stamps = fileMut.record!.timestamps as Record<string, string | null>;
  stamps["evaluated_at"] = at("09:02:41", DAY);
  stamps["approved_at"] = at("09:31:00", DAY);
  advanceMutation(fileMut, "AUTHORIZED", at("09:31:01", DAY));
  advanceMutation(fileMut, "DISPATCHED", at("09:31:03", DAY));
  advanceMutation(fileMut, "ACKED", at("09:31:05", DAY), { externalRef: "SIERRA-CLM-55102" });
  advanceMutation(fileMut, "VERIFIED", at("09:31:06", DAY));
  view.execution.plans = [{ plan_id: PLAN, rec_id: REC_FILE, atomicity: "ALL_OR_NOTHING", status: "DONE",
    steps: [{ step_seq: 1, action_type: "FILE_CLAIM", target_system: "CARRIER", mutation_id: fileMut.mutation_id }], created_at: at("09:31:01", DAY), updated_at: at("09:31:06", DAY) }];
  view.execution.mutations = [fileMut];
  Object.assign(view.outcome.claims[0]!, { status: "FILED", amount_usd: CLAIM_USD, filed_at: at("09:31:05", DAY), variant_option_id: full.option_id, evidence_pack_id: PACK_D2, updated_at: at("09:31:05", DAY) });
  ledger.append(at("09:31:01", DAY), "ACTION_QUEUED", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#${fileMut.mutation_id}`, { mutation_id: fileMut.mutation_id, action_type: "FILE_CLAIM" });
  ledger.append(at("09:31:06", DAY), "ACTION_ACKED", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.MUTATIONS#${fileMut.mutation_id}`, { mutation_id: fileMut.mutation_id, status: "VERIFIED", external_ref: "SIERRA-CLM-55102" });
  ledger.append(at("09:31:07", DAY), "CLAIM_UPDATE", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.CLAIMS#${CLAIM}`, { claim_id: CLAIM, status: "FILED", amount_usd: CLAIM_USD });
  transition(view, "CLAIM_OPEN", at("09:31:07", DAY));
  const filed = frames.push(frame("Claim filed with Sierra ($21,355); awaiting the carrier's response", view, ledger, ctx, extras)) - 1;

  // ---- The carrier defends and offers 80%; the agent rebuts and recommends accepting ------------
  transition(view, "CLAIMS_PENDING", at("13:40:00", DAY));
  Object.assign(view.outcome.claims[0]!, { status: "RESPONDED", updated_at: at("13:40:00", DAY) });
  ledger.append(at("13:40:00", DAY), "CLAIM_UPDATE", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.CLAIMS#${CLAIM}`, { claim_id: CLAIM, status: "RESPONDED", response_id: "RSP-SIERRA-55102-1", defense: "WARM_LOADING", offer_usd: OFFER_USD });
  const acceptNarrative = "Accept Sierra's $17,084 offer. Its warm-loading defense fails: pulp at loading was 0.8 C against the 0.5 C setpoint on the BOL.";
  view.options = [full, settle, absorb];
  const briefAccept = briefFor(REC_ACCEPT, settle, [settle, full, absorb], at("13:42:30", DAY), acceptNarrative, "brief-S-C-accept");
  const acceptRec = fixture<ClaimRec>("claim_recommendation", 0);
  Object.assign(acceptRec, {
    action: "ACCEPT_OFFER", variant_option_id: settle.option_id, response_to: "RSP-SIERRA-55102-1",
    letter_draft: `Sierra Cold Freight - we accept your offer of $17,084.00 in full settlement of claim SIERRA-CLM-55102 (shipment ${SHIPMENT}).`,
    citations: [`EV:LOSS:${SC_CASE}`, "EV:SIG:WARM_LOADING@1", "EV:RSP:RSP-SIERRA-55102-1"],
  });
  view.decision.recommendations[0]!.status = "SUPERSEDED";
  const acceptFirst = "Accept Sierra's $17,084 offer.";
  view.decision.recommendations.push({
    rec_id: REC_ACCEPT, decision_point: "D2", option_id: settle.option_id, decided_by: "AGENT", decider_id: "CLAIMS_RECOVERY@1", run_id: RUN_C2,
    escalation_reasons: ["QUALITATIVE_SIGNAL"], status: "ACTIVE", audit_status: "PASS", brief: briefAccept, brief_hash: briefAccept.brief_hash, submission: acceptRec,
    audit_verdict: { statements: [
      { span: { start: 0, end: Array.from(acceptFirst).length }, statement: acceptFirst, verdict: "SUPPORTED", evidence_ids: ["EV:RSP:RSP-SIERRA-55102-1"] },
      { span: { start: Array.from(acceptFirst).length + 1, end: Array.from(acceptNarrative).length },
        statement: "Its warm-loading defense fails: pulp at loading was 0.8 C against the 0.5 C setpoint on the BOL.", verdict: "SUPPORTED", evidence_ids: ["EV:SIG:WARM_LOADING@1"] },
    ], overall: "PASS", required_fixes: [] },
    audited_text: acceptNarrative, created_at: at("13:42:30", DAY),
  });
  view.agents.runs.push(agentRun(RUN_C2, "CLAIMS_RECOVERY", "claude-sonnet-4-5", at("13:40:20", DAY), at("13:42:28", DAY), ["GET_CASE_CONTEXT", "ANALYZE_CAUSAL_SIGNATURES", "SIMULATE_CLAIM_VARIANTS", "SUBMIT_CLAIM_RECOMMENDATION"]));
  view.case.current_rec_id = REC_ACCEPT;
  view.case.current_brief_hash = briefAccept.brief_hash;
  ledger.append(at("13:42:30", DAY), "RECOMMENDATION", SC_CASE, "BBC_AGENT_SVC", `BBC_OS.DECISION.RECOMMENDATIONS#${REC_ACCEPT}`, { rec_id: REC_ACCEPT, action: "ACCEPT_OFFER", amount_usd: OFFER_USD });
  transition(view, "PENDING_APPROVAL", at("13:43:00", DAY));
  view.governance.evaluations.push(evaluation(EVAL_ACCEPT, REC_ACCEPT, at("13:43:00", DAY), OFFER_USD));
  view.governance.approvals.push(approval(APR_ACCEPT, EVAL_ACCEPT, REC_ACCEPT, at("13:43:00", DAY), briefAccept.brief_hash));
  ledger.append(at("13:43:00", DAY), "POLICY_EVALUATION", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.POLICY_EVALUATIONS#${EVAL_ACCEPT}`, { eval_id: EVAL_ACCEPT, outcome: "APPROVE", required_roles: ["BBC_FINANCE_MGR"] });
  const pendingAccept = frames.push(frame("Carrier defense rebutted: accept the in-band 80% offer? (Finance)", view, ledger, ctx, extras)) - 1;

  // ---- Settled and sealed ---------------------------------------------------------------------------
  decide(APR_ACCEPT, at("14:05:00", DAY));
  Object.assign(view.outcome.claims[0]!, { status: "SETTLED", paid_usd: OFFER_USD, updated_at: at("16:20:00", DAY) });
  ledger.append(at("16:20:00", DAY), "CLAIM_UPDATE", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.CLAIMS#${CLAIM}`, { claim_id: CLAIM, status: "SETTLED", paid_usd: OFFER_USD });
  transition(view, "SETTLED", at("16:20:00", DAY));
  transition(view, "SEALED", at("16:20:05", DAY));
  view.evidence.sealed = true;
  view.evidence.sealed_at = at("16:20:05", DAY);
  ledger.append(at("16:20:05", DAY), "CASE_SEALED", SC_CASE, ENGINE_USER, `BBC_OS.DECISION.CASES#${SC_CASE}`, { case_id: SC_CASE, recovered_usd: OFFER_USD, memory_record: "MEM-00000011" });
  frames.push(frame("Settled for $17,084 and sealed; the decision record is committed to memory", view, ledger, ctx, { ...extras, isOpen: false, sealedAt: at("16:20:05", DAY) }));

  const v = (i: number) => frames[i]!.cases[SC_CASE]!.view;
  const ok = (id: string, decidedAt: string, f: number, hash: string, state: CaseView["case"]["state"]) => ({
    status: "OK", approval_id: id, approval_status: "APPROVED", decided_by: PERSONA_IDS.finance.user, decided_role: "BBC_FINANCE_MGR",
    decided_at: decidedAt, chosen_option_id: null, brief_hash: hash, case_state: state, state_version: v(f).case.state_version, remaining_approval_ids: [],
    ledger_seq: v(f).evidence.ledger.entries.find((e) => e.entry_type === "APPROVAL" && e.record_ref.endsWith(id))!.seq,
  });
  const responses: TapeResponse[] = [
    { call: "DECIDE_APPROVAL", persona: "finance", at_frames: [pendingFile], match: { approval_id: APR_FILE, verdict: "APPROVE" },
      result: ok(APR_FILE, at("09:31:00", DAY), filed, briefFile.brief_hash, "APPROVED"), advance_to_frame: filed },
    { call: "DECIDE_APPROVAL", persona: "finance", at_frames: [pendingAccept], match: { approval_id: APR_ACCEPT, verdict: "APPROVE" },
      result: ok(APR_ACCEPT, at("14:05:00", DAY), frames.length - 1, briefAccept.brief_hash, "APPROVED"), advance_to_frame: frames.length - 1 },
  ];
  return {
    tape: "S-C",
    title: "S-C: carrier defense, claim and settlement (D2)",
    provenance: "SYNTHETIC (design numbers)",
    description:
      "After an earlier reefer failure, D2 settlement opens. Claims & Recovery files from the deterministic loss basis; the carrier " +
      "defends with warm loading and offers 80%; the agent rebuts from the causal signatures and recommends accepting inside the policy band. " +
      "Finance approves both steps; the claim settles and the case is sealed into decision memory.",
    personas: PERSONA_IDS,
    frames: frames as Tape["frames"],
    responses: [...responses, ...proofResponses(frames, SC_CASE, ledger, 302, policyRow)],
    analyst: [],
    agent_traces: {},
  };
}
