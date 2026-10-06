/**
 * Authoring kit for synthetic tapes. This code stands in for Snowflake when writing
 * test data: it computes what the read model would contain (ledger hashes, thermal
 * buckets, which actions a viewer has). It never runs in the app; the player only
 * replays its output.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalHash,
  contractsDir,
  normalizeTs,
  sha256Hex,
  type ApiCaseView,
  type ApiInboxRow,
  type ApiTape,
} from "@blueberrychain/shared";

export type CaseView = ApiCaseView.CaseView;
export type Viewer = ApiCaseView.Viewer;
export type AvailableAction = ApiCaseView.AvailableAction;
export type LedgerEntry = ApiCaseView.LedgerEntry;
export type LotThermal = ApiCaseView.LotThermal;
export type Option = ApiCaseView.Option;
export type ApprovalRow = ApiCaseView.ApprovalRow;
export type MutationRow = ApiCaseView.MutationRow;
export type InboxRow = ApiInboxRow.CaseInboxRow;
export type Tape = ApiTape.FixtureTape;
export type Persona = ApiTape.Persona;
export type TapeFrame = Tape["frames"][number];
export type TapeResponse = Tape["responses"][number];
export type PersonaRole = Viewer["role"];

export const PERSONA_IDS: Record<Persona, { user: string; role: PersonaRole }> = {
  quality: { user: "BBC_DEMO_QUALITY", role: "BBC_QUALITY_MGR" },
  sales: { user: "BBC_DEMO_SALES", role: "BBC_SALES_MGR" },
  finance: { user: "BBC_DEMO_FINANCE", role: "BBC_FINANCE_MGR" },
  auditor: { user: "BBC_DEMO_AUDITOR", role: "BBC_AUDITOR" },
  govadmin: { user: "BBC_DEMO_GOVADMIN", role: "BBC_GOVERNANCE_ADMIN" },
};
export const ALL_PERSONAS = Object.keys(PERSONA_IDS) as Persona[];
export const ENGINE_USER = "BBC_ENGINE_SVC";
export const TASK_USER = "SYSTEM";

export const clone = <T>(value: T): T => structuredClone(value);

/** valid[index] of a contract fixture (contracts/fixtures/<name>.json), deep-copied. */
export function fixture<T>(name: string, index = 0): T {
  const doc = JSON.parse(readFileSync(join(contractsDir(), "fixtures", `${name}.json`), "utf-8")) as { valid: T[] };
  const value = doc.valid[index];
  if (value === undefined) throw new Error(`fixture ${name} has no valid[${index}]`);
  return clone(value);
}

/** A deterministic stand-in sha256 for something whose real hash Snowflake would compute. */
export const fakeHash = (label: string): string => sha256Hex(`bbc-tape:${label}`);

/** 2026-10-06 (or another day) wall-clock time in UTC. */
export const at = (hms: string, day = "2026-10-06"): string => `${day}T${hms}Z`;

/** Minutes after a timestamp, as ISO-8601 UTC. */
export function plusMin(ts: string, minutes: number): string {
  return new Date(Date.parse(ts) + minutes * 60_000).toISOString().replace(".000Z", "Z");
}

/** A real hash chain (bbc_toolkit.ledger semantics), so the proof view is internally consistent. */
export class LedgerChain {
  readonly entries: LedgerEntry[] = [];
  private prev: string;
  private nextSeq: number;
  readonly payloadOf = new Map<number, unknown>();

  constructor(firstSeq: number, prevHash: string) {
    this.nextSeq = firstSeq;
    this.prev = prevHash;
  }

  append(ts: string, entryType: string, caseId: string, actor: string, recordRef: string, payload: unknown): LedgerEntry {
    const payloadHash = canonicalHash(payload);
    const header = {
      seq: this.nextSeq,
      ts: normalizeTs(ts),
      entry_type: entryType,
      case_id: caseId,
      actor,
      record_ref: recordRef,
      payload_hash: payloadHash,
      prev_hash: this.prev,
    };
    const entry: LedgerEntry = {
      seq: header.seq,
      ts: header.ts,
      entry_type: entryType,
      actor,
      record_ref: recordRef,
      payload_hash: payloadHash,
      prev_hash: this.prev,
      entry_hash: canonicalHash(header),
    };
    this.entries.push(entry);
    this.payloadOf.set(entry.seq, payload);
    this.prev = entry.entry_hash;
    this.nextSeq += 1;
    return entry;
  }

  get firstSeq(): number | null {
    return this.entries[0]?.seq ?? null;
  }

  get lastSeq(): number | null {
    return this.entries.at(-1)?.seq ?? null;
  }

  find(entryType: string): LedgerEntry {
    const e = this.entries.find((x) => x.entry_type === entryType);
    if (!e) throw new Error(`no ${entryType} entry`);
    return e;
  }
}

export interface Holder {
  from: string;
  party: string;
  type: ApiCaseView.LotThermal["buckets"][number]["holder_type"];
}

export interface ThermalSpec {
  lotId: string;
  thresholdC: number;
  trefC: number;
  q10: number;
  from: string;
  to: string;
  holders: Holder[];
  /** Pulp temperature at an instant. */
  pulp: (ts: number) => number;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** 15-minute buckets per holder, sampled every minute (OPS.LOT_THERMAL_BUCKETS physics). */
export function thermal(spec: ThermalSpec): LotThermal {
  const rate = (t: number) => spec.q10 ** ((t - spec.trefC) / 10);
  const holderAt = (ts: number) => [...spec.holders].reverse().find((h) => Date.parse(h.from) < ts) ?? spec.holders[0]!;
  const buckets: LotThermal["buckets"] = [];
  const end = Date.parse(spec.to);
  for (let start = Date.parse(spec.from); start < end; start += 15 * 60_000) {
    const samples: number[] = [];
    for (let m = 1; m <= 15 && start + m * 60_000 <= end; m++) samples.push(spec.pulp(start + m * 60_000));
    if (!samples.length) continue;
    const holder = holderAt(start + 60_000);
    buckets.push({
      start: new Date(start).toISOString().replace(".000Z", "Z"),
      holder_party_id: holder.party,
      holder_type: holder.type,
      readings: samples.length,
      reading_min: samples.length,
      breach_min: samples.filter((t) => t > spec.thresholdC).length,
      min_pulp_c: round(Math.min(...samples), 2),
      max_pulp_c: round(Math.max(...samples), 2),
      excess_h: round(samples.reduce((s, t) => s + Math.max(rate(t) - rate(spec.thresholdC), 0) / 60, 0), 4),
    });
  }
  return { lot_id: spec.lotId, threshold_c: spec.thresholdC, as_of: spec.to, truncated: false, buckets };
}

/** Piecewise-linear interpolation through (iso time, value) knots. */
export function curve(knots: [string, number][]): (ts: number) => number {
  const pts = knots.map(([t, v]) => [Date.parse(t), v] as const);
  return (ts) => {
    if (ts <= pts[0]![0]) return pts[0]![1];
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1] = pts[i]!;
      const [t0, v0] = pts[i - 1]!;
      if (ts <= t1) return v0 + ((v1 - v0) * (ts - t0)) / (t1 - t0);
    }
    return pts.at(-1)![1];
  };
}

/** What Snowflake would compute for one viewer, from the approvals and proof state in a view. */
export interface ViewerContext {
  view: CaseView;
  /** Options an approver could choose instead of the recommendation. */
  choosable: string[];
  /** Personas whose role may reverse the executed decision now. */
  reversers?: Persona[];
  dispatchEnabled?: boolean;
}

export function viewersFor(ctx: ViewerContext): Record<Persona, Viewer> {
  const out = {} as Record<Persona, Viewer>;
  const packIds = ctx.view.analysis.packs.map((p) => p.pack_id);
  for (const persona of ALL_PERSONAS) {
    const { user, role } = PERSONA_IDS[persona];
    const actions: AvailableAction[] = [];
    for (const a of ctx.view.governance.approvals) {
      const base = { action: "DECIDE_APPROVAL" as const, approval_id: a.approval_id, required_role: a.required_role };
      if (role === "BBC_AUDITOR" || role === "BBC_GOVERNANCE_ADMIN") {
        actions.push({ ...base, enabled: false, disabled_reason: `${role} observes approvals; it never decides them` });
      } else if (a.required_role !== role) {
        actions.push({ ...base, enabled: false, disabled_reason: `This approval requires ${a.required_role}` });
      } else if (a.status !== "REQUESTED") {
        actions.push({ ...base, enabled: false, disabled_reason: `Already ${a.status.toLowerCase().replace("_", " ")} by ${a.decided_by ?? "?"}` });
      } else if (a.proposer === user) {
        actions.push({ ...base, enabled: false, disabled_reason: "Separation of duties: the proposer cannot approve" });
      } else {
        actions.push({
          ...base,
          enabled: true,
          disabled_reason: null,
          verdicts: ["APPROVE", "CHOOSE_ALTERNATIVE", "REJECT"],
          choosable_option_ids: ctx.choosable,
          reason_required_for: ["CHOOSE_ALTERNATIVE", "REJECT"],
          due_at: a.due_at,
        });
      }
    }
    if (ctx.reversers?.includes(persona) && ctx.view.case.current_rec_id) {
      actions.push({ action: "REVERSE_DECISION", enabled: true, disabled_reason: null, rec_id: ctx.view.case.current_rec_id });
    }
    if (role === "BBC_AUDITOR") {
      actions.push({ action: "VERIFY_LEDGER", enabled: true, disabled_reason: null });
      actions.push(packIds.length
        ? { action: "REPLAY_EVIDENCE", enabled: true, disabled_reason: null, pack_ids: packIds }
        : { action: "REPLAY_EVIDENCE", enabled: false, disabled_reason: "No evidence pack has been sealed yet" });
    }
    if (role === "BBC_AUDITOR" || role === "BBC_FINANCE_MGR") {
      actions.push(packIds.length
        ? { action: "EXPORT_EVIDENCE_PACK", enabled: true, disabled_reason: null }
        : { action: "EXPORT_EVIDENCE_PACK", enabled: false, disabled_reason: "No evidence pack has been sealed yet" });
    }
    if (role === "BBC_GOVERNANCE_ADMIN") {
      actions.push(ctx.dispatchEnabled === false
        ? { action: "EMERGENCY_STOP", enabled: false, disabled_reason: "Dispatch is already stopped" }
        : { action: "EMERGENCY_STOP", enabled: true, disabled_reason: null });
    }
    out[persona] = { user, role, available_actions: actions };
  }
  return out;
}

export interface InboxExtras {
  inboxRank: number;
  fallbackAt: string | null;
  isOpen?: boolean;
  sealedAt?: string | null;
}

/** The V_CASE_INBOX row each persona would see for a view. */
export function inboxFor(view: CaseView, viewers: Record<Persona, Viewer>, extras: InboxExtras): Record<Persona, InboxRow[]> {
  const open = view.governance.approvals.filter((a) => a.status === "REQUESTED");
  const rec = view.decision.recommendations.find((r) => r.status === "ACTIVE") ?? null;
  const evaluation = view.governance.evaluations.at(-1) ?? null;
  const due = open.map((a) => a.due_at).sort()[0] ?? null;
  const out = {} as Record<Persona, InboxRow[]>;
  for (const persona of ALL_PERSONAS) {
    const awaitingMe = viewers[persona].available_actions.some((a) => a.action === "DECIDE_APPROVAL" && a.enabled);
    out[persona] = [{
      case_id: view.case.case_id,
      decision_point: view.case.decision_point,
      state: view.case.state,
      state_version: view.case.state_version,
      change_token: view.change_token,
      severity: view.case.severity,
      shipment_id: view.case.shipment_id,
      lot_ids: view.case.lots.map((l) => l.lot_id) as InboxRow["lot_ids"],
      opened_at: view.case.opened_at,
      onset_at: view.case.onset_at,
      deadline_ts: view.case.deadline_ts,
      due_at: due,
      fallback_at: extras.fallbackAt,
      value_at_risk_usd: view.case.value_at_risk_usd,
      decided_by: rec?.decided_by ?? null,
      evaluation_outcome: evaluation?.outcome ?? null,
      autonomy_level: evaluation?.autonomy_level ?? null,
      awaiting_roles: [...new Set(open.map((a) => a.required_role))],
      awaiting_me: awaitingMe,
      needs_reassessment: view.case.needs_reassessment,
      inbox_rank: extras.inboxRank,
      is_open: extras.isOpen ?? true,
      sealed_at: extras.sealedAt ?? null,
      policy_version: view.case.policy_version,
      provenance: view.case.provenance,
      updated_at: view.case.updated_at,
    }];
  }
  return out;
}

/** Finish a frame: stamp the change token and the ledger slice, then snapshot it. */
export function frame(label: string, view: CaseView, ledger: LedgerChain, ctx: Omit<ViewerContext, "view">, extras: InboxExtras): TapeFrame {
  const v = clone(view);
  v.evidence.ledger = { entries: clone(ledger.entries), first_seq: ledger.firstSeq, last_seq: ledger.lastSeq, truncated: false };
  v.change_token = `${v.case.state_version}:${ledger.lastSeq ?? 0}`;
  const viewers = viewersFor({ ...ctx, view: v });
  v.viewer = viewers.auditor;
  return { label, inbox: inboxFor(v, viewers, extras), cases: { [v.case.case_id]: { view: v, viewers } } };
}

/** Standard proof recordings for every frame: verify (and a tamper clone), replay, export, policy. */
export function proofResponses(frames: TapeFrame[], caseId: string, ledger: LedgerChain, tamperSeq: number, policyRow: unknown): TapeResponse[] {
  const out: TapeResponse[] = [];
  frames.forEach((f, i) => {
    const view = f.cases[caseId]!.view;
    const { first_seq, last_seq } = view.evidence.ledger;
    const verifiedAt = plusMin(view.generated_at, 1);
    if (first_seq !== null && last_seq !== null) {
      out.push({
        call: "VERIFY_LEDGER", persona: "auditor", at_frames: [i], match: { ledger_table: "BBC_OS.LEDGER.ENTRIES" },
        result: { status: "OK", ledger_table: "BBC_OS.LEDGER.ENTRIES", from_seq: first_seq, to_seq: last_seq, ok: true,
                  checked: last_seq - first_seq + 1, first_bad_seq: null, reason: null, bad_entry: null, verified_at: verifiedAt },
        advance_to_frame: null,
      });
      if (last_seq >= tamperSeq) {
        const bad = ledger.entries.find((e) => e.seq === tamperSeq)!;
        out.push({
          call: "VERIFY_LEDGER", persona: "auditor", at_frames: [i], match: { ledger_table: "BBC_OS.SANDBOX.LEDGER_TAMPER" },
          result: { status: "OK", ledger_table: "BBC_OS.SANDBOX.LEDGER_TAMPER", from_seq: first_seq, to_seq: last_seq, ok: false,
                    checked: tamperSeq - first_seq, first_bad_seq: tamperSeq, reason: "PAYLOAD_HASH_MISMATCH",
                    bad_entry: { seq: tamperSeq, expected_hash: fakeHash(`tampered-payload-${tamperSeq}`), actual_hash: bad.payload_hash },
                    verified_at: verifiedAt },
          advance_to_frame: null,
        });
      }
    }
    for (const pack of view.analysis.packs) {
      out.push({
        call: "REPLAY_EVIDENCE", persona: "auditor", at_frames: [i], match: { pack_id: pack.pack_id },
        result: { status: "OK", pack_id: pack.pack_id, as_of: pack.as_of, original_hash: pack.content_hash,
                  replayed_hash: pack.content_hash, equal: true, diff: [], replayed_at: verifiedAt },
        advance_to_frame: null,
      });
    }
    if (view.analysis.packs.length && first_seq !== null && last_seq !== null) {
      for (const persona of ["auditor", "finance"] as const) {
        out.push({
          call: "EXPORT_EVIDENCE_PACK", persona, at_frames: [i], match: { case_id: caseId },
          result: { status: "OK", case_id: caseId, stage_path: `@BBC_OS.EVIDENCE.EXPORT_STAGE/${caseId}/evidence-${last_seq}.json`,
                    url: `https://pndvhar-pt70809.snowflakecomputing.com/fixture-export/${caseId}/${last_seq}`,
                    url_expires_at: plusMin(verifiedAt, 60), sha256: fakeHash(`export-${caseId}-${last_seq}`),
                    bytes: 40_000 + 1_500 * (last_seq - first_seq), ledger_from_seq: first_seq, ledger_to_seq: last_seq,
                    exported_at: verifiedAt },
          advance_to_frame: null,
        });
      }
    }
  });
  out.push({
    call: "ACTIVE_POLICY", persona: "govadmin", at_frames: frames.map((_, i) => i) as TapeResponse["at_frames"], match: {}, result: policyRow as Record<string, unknown>,
    advance_to_frame: null,
  });
  out.push({
    call: "EMERGENCY_STOP", persona: "govadmin", at_frames: frames.map((_, i) => i) as TapeResponse["at_frames"], match: {},
    result: { status: "OK", dispatch_enabled: false, stopped_by: PERSONA_IDS.govadmin.user, stopped_at: at("08:00:00"),
              reason: "recorded emergency stop", ledger_seq: 9000 },
    advance_to_frame: null,
  });
  return out;
}

/** A case view with every section present and empty (the read model before any stage has run). */
export function baseView(c: CaseView["case"], detection: Record<string, unknown>): CaseView {
  return {
    view_version: "1",
    generated_at: c.opened_at,
    change_token: "1:0",
    viewer: { user: PERSONA_IDS.auditor.user, role: PERSONA_IDS.auditor.role, available_actions: [] },
    case: c,
    event: { detection },
    analysis: { pack: null, packs: [], thermal: [], findings: [] },
    options: [],
    decision: { recommendations: [] },
    governance: {
      policy: { policy_version: c.policy_version, kill_switches: { autonomy_ceiling: 4, shadow_mode: false, fallback_enabled: true, dispatch_enabled: true } },
      evaluations: [],
      approvals: [],
      fallback: null,
    },
    execution: { plans: [], mutations: [] },
    outcome: { lots: [], claims: [] },
    agents: { runs: [] },
    evidence: { sealed: false, sealed_at: null, ledger: { entries: [], first_seq: null, last_seq: null, truncated: false } },
  };
}

/** Advance the case's state (state_version + 1) at a time. */
export function transition(view: CaseView, state: CaseView["case"]["state"], ts: string): void {
  view.case.state = state;
  view.case.state_version += 1;
  view.case.updated_at = ts;
  view.generated_at = ts;
}

/** A mutation row (intent + gateway record) built from the contract fixture's REROUTE record. */
export function mutation(spec: {
  mutationId: string;
  planId: string;
  stepSeq: number;
  actionType: MutationRow["action_type"];
  targetSystem: MutationRow["target_system"];
  target: { type: MutationRow["intent"]["target_entity"]["type"]; id: string };
  payload: Record<string, unknown>;
  expectedBefore: Record<string, unknown>;
  expectedAfter: Record<string, unknown>;
  caseId: string;
  decisionPoint: "D1" | "D2";
  recId: string;
  optionId: string;
  briefHash: string;
  packId: string;
  evalId: string;
  approvalIds: string[];
  autonomyLevel: number;
  decider: { kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK"; id: string; runId?: string | null; model?: string | null; spec?: string | null };
  approvers: { user: string; role: string; approval_id: string }[];
  proposedAt: string;
}): MutationRow {
  const record = fixture<NonNullable<MutationRow["record"]>>("mutation_record");
  const intent: MutationRow["intent"] = {
    ...record.intent,
    case_id: spec.caseId,
    decision_point: spec.decisionPoint,
    rec_id: spec.recId,
    option_id: spec.optionId,
    plan_id: spec.planId,
    step_seq: spec.stepSeq,
    action_type: spec.actionType,
    target_system: spec.targetSystem,
    target_entity: spec.target,
    payload: spec.payload,
    idempotency_key: fakeHash(`idem-${spec.mutationId}`),
    brief_hash: spec.briefHash,
    pack_id: spec.packId,
    expected_before: spec.expectedBefore,
    expected_after: spec.expectedAfter,
    compensation_of: null,
    requested_by: { kind: "ENGINE", principal: ENGINE_USER },
  };
  return {
    mutation_id: spec.mutationId,
    plan_id: spec.planId,
    step_seq: spec.stepSeq,
    status: "AUTHORIZED",
    action_type: spec.actionType,
    target_system: spec.targetSystem,
    compensation_of: null,
    compensated_by: null,
    updated_at: spec.proposedAt,
    intent,
    record: {
      ...record,
      mutation_id: spec.mutationId,
      intent,
      status: "AUTHORIZED",
      autonomy_level: spec.autonomyLevel,
      policy_eval_id: spec.evalId,
      approval_ids: spec.approvalIds,
      authorization_hash: fakeHash(`auth-${spec.mutationId}`),
      observed_before: null,
      observed_after: null,
      actor_chain: {
        decider_kind: spec.decider.kind,
        decider_id: spec.decider.id,
        agent_run_id: spec.decider.runId ?? null,
        model: spec.decider.model ?? null,
        spec_version: spec.decider.spec ?? null,
        executor_user: ENGINE_USER,
        executor_role: "BBC_ENGINE",
        approvers: spec.approvers,
      },
      timestamps: { proposed_at: spec.proposedAt },
      external_ref: null,
      attempts: 0,
      last_error: null,
      compensated_by: null,
    },
  };
}

/** Move a mutation through the gateway's statuses with the timestamps the record keeps. */
export function advanceMutation(
  m: MutationRow,
  status: MutationRow["status"],
  ts: string,
  extra: { externalRef?: string; observedBefore?: Record<string, unknown>; observedAfter?: Record<string, unknown> } = {},
): void {
  m.status = status;
  m.updated_at = ts;
  const r = m.record!;
  r.status = status;
  const stamps = r.timestamps as Record<string, string | null | undefined>;
  if (status === "AUTHORIZED") stamps["authorized_at"] = ts;
  if (status === "DISPATCHED") {
    stamps["dispatched_at"] = ts;
    r.attempts = 1;
    r.observed_before = extra.observedBefore ?? clone(m.intent.expected_before);
  }
  if (status === "ACKED") {
    stamps["acked_at"] = ts;
    stamps["target_reported_at"] = ts;
  }
  if (status === "VERIFIED") {
    stamps["verified_at"] = ts;
    r.observed_after = extra.observedAfter ?? { ...clone(m.intent.expected_before), ...clone(m.intent.expected_after) };
  }
  if (extra.externalRef) r.external_ref = extra.externalRef;
}
