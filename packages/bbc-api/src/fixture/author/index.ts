/**
 * Builds the synthetic tapes (contracts/tapes/*.json) and the contract fixtures that
 * are cut from them (contracts/fixtures/api/{case_view,inbox_row,tape}.json).
 * Run `corepack pnpm --filter @blueberrychain/bbc-api tapes` after changing a scenario;
 * a drift test fails if the committed files are stale.
 */

import { buildSA, SA_CASE } from "./s-a.js";
import { buildSB, SB_CASE } from "./s-b.js";
import { buildSC, SC_CASE } from "./s-c.js";
import { clone, fixture, type Tape } from "./kit.js";

export interface ContractFixture {
  schema: string;
  valid: unknown[];
  invalid: { why: string; base: number; set?: Record<string, unknown>; delete?: string[] }[];
}

export interface Built {
  tapes: Tape[];
  fixtures: Record<string, ContractFixture>;
}

export function buildAll(): Built {
  const policyRow = fixture<Record<string, unknown>>("api/active_policy");
  const sa = buildSA(policyRow);
  const sb = buildSB(policyRow);
  const sc = buildSC(policyRow);
  const tapes = [sa, sb, sc];

  const saView = (i: number) => sa.frames[i]!.cases[SA_CASE]!.view;
  const pendingIndex = sa.frames.findIndex((f) => f.cases[SA_CASE]!.view.case.state === "PENDING_APPROVAL");
  const outcomeIndex = sa.frames.findIndex((f) => f.cases[SA_CASE]!.view.case.state === "OUTCOME_RECORDED");
  const sbAudited = sb.frames.find((f) => f.cases[SB_CASE]!.view.decision.recommendations.some((r) => r.audit_verdict))!;
  const scClaim = sc.frames.at(-1)!;

  const caseView: ContractFixture = {
    schema: "api/case_view.json",
    valid: [saView(0), saView(pendingIndex), saView(outcomeIndex), sbAudited.cases[SB_CASE]!.view, scClaim.cases[SC_CASE]!.view],
    invalid: [
      { why: "every lifecycle section is always present", base: 0, delete: ["/governance"] },
      { why: "the change token is state_version:ledger_seq", base: 0, set: { "/change_token": "fresh" } },
      { why: "viewer roles are persona roles, never service roles", base: 0, set: { "/viewer/role": "BBC_ENGINE" } },
      { why: "available actions are a frozen vocabulary", base: 1, set: { "/viewer/available_actions/0/action": "APPROVE_ALL" } },
      { why: "a disabled action carries its reason field", base: 1, delete: ["/viewer/available_actions/0/disabled_reason"] },
      { why: "approvals bind to a sha256 Brief hash", base: 1, set: { "/governance/approvals/0/brief_hash_at_request": "latest" } },
      { why: "the evidence pack must satisfy its own contract", base: 1, delete: ["/analysis/pack/content_hash"] },
      { why: "policy evaluation outcomes are a frozen vocabulary", base: 1, set: { "/governance/evaluations/0/outcome": "SHADOW" } },
      { why: "mutation records must satisfy the gateway contract", base: 2, delete: ["/execution/mutations/0/record/actor_chain"] },
      { why: "ledger entries carry their hashes", base: 2, set: { "/evidence/ledger/entries/0/entry_hash": "x" } },
      { why: "thermal buckets name the holder", base: 0, delete: ["/analysis/thermal/0/buckets/0/holder_party_id"] },
      { why: "audit verdicts must satisfy their contract", base: 3, set: { "/decision/recommendations/0/audit_verdict/overall": "MOSTLY" } },
    ],
  };

  const salesPending = sa.frames[pendingIndex]!.inbox.sales![0]!;
  const inboxRow: ContractFixture = {
    schema: "api/inbox_row.json",
    valid: [salesPending, sa.frames[outcomeIndex]!.inbox.auditor![0]!],
    invalid: [
      { why: "inbox ranks start at 1", base: 0, set: { "/inbox_rank": 0 } },
      { why: "awaited roles are persona roles", base: 0, set: { "/awaiting_roles": ["BBC_ENGINE"] } },
      { why: "awaiting_me is computed in Snowflake and always present", base: 0, delete: ["/awaiting_me"] },
      { why: "the change token is state_version:ledger_seq", base: 1, set: { "/change_token": "v2" } },
    ],
  };

  const mini = clone(sa);
  mini.tape = "S-A-MINI";
  mini.frames = mini.frames.slice(0, 2) as Tape["frames"];
  mini.responses = mini.responses.filter((r) => r.at_frames.every((f) => f < 2)).slice(0, 4);
  mini.analyst = mini.analyst.slice(0, 1);
  const tape: ContractFixture = {
    schema: "api/tape.json",
    valid: [mini],
    invalid: [
      { why: "provenance is synthetic or a named live recording", base: 0, set: { "/provenance": "made up" } },
      { why: "personas are the five demo personas", base: 0, set: { "/personas/admin": { user: "ADMIN", role: "BBC_AUDITOR" } } },
      { why: "recorded calls are persona-facing interfaces only", base: 0, set: { "/responses/0/call": "ADVANCE_CASE" } },
      { why: "frames hold valid case views", base: 0, delete: [`/frames/0/cases/${SA_CASE}/view/case`] },
    ],
  };

  return { tapes, fixtures: { case_view: caseView, inbox_row: inboxRow, tape } };
}

/** Tapes are generated and large, so they are stored compact (one line). */
export const serializeTape = (tape: Tape): string => `${JSON.stringify(tape)}\n`;
export const serializeFixture = (f: ContractFixture): string => `${JSON.stringify(f, null, 2)}\n`;
