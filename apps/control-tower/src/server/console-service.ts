/**
 * The console's server side: one entry per input, recorded in the session's history.
 *
 * - Read commands become artifacts cut from the case view.
 * - Proof commands run a read-only API procedure if Snowflake's available_actions offers it.
 * - Write commands never run directly. They become a confirm card plus a short-lived,
 *   single-use grant for the exact bound CALL; `confirm` runs that call verbatim, as the
 *   signed-in person's own Snowflake identity. Snowflake still enforces every rule
 *   (role, proposer != approver, Brief freshness, deadline) and its answer is shown as-is.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  AuthError,
  ContractViolationError,
  INTERFACES,
  InterfaceUnavailableError,
  RefusedError,
  answerQuestion,
  bindCall,
  isRefusal,
  refusalText,
  type AvailableAction,
  type BoundCall,
  type CaseView,
  type PersonaCall,
  type PersonaPort,
} from "@blueberrychain/bbc-api";
import type { Artifact, ConfirmCard, ConsoleEntry, ErrorArtifact } from "../console/artifacts";
import { PROOF_VERBS, WRITE_VERBS, type Command } from "../console/grammar";
import { parseCommand } from "../console/parse";
import { activeRecommendation, helpArtifact, readArtifact } from "../console/read";
import { STATE_TEXT } from "../console/templates";
import { resolveId } from "../domain/ids";
import type { AppContext } from "./context";
import type { ConfirmGrant, Session } from "./session";

const GRANT_TTL_MS = 90_000;

/** "10:20 UTC on 2026-10-06" for warning text. */
const when = (ts: string) => `${ts.slice(11, 16)} UTC on ${ts.slice(0, 10)}`;
const MAIN_LEDGER = "BBC_OS.LEDGER.ENTRIES";

const err = (message: string, suggestions: string[] = [], code: string | null = null): ErrorArtifact => ({ type: "error", message, code, suggestions });

/** Turn a port failure into an error artifact that says what happened and what delivers the fix. */
export function errorArtifact(error: unknown): ErrorArtifact {
  if (error instanceof InterfaceUnavailableError) {
    return err(`${error.interfaceName} isn't available to you yet. It is delivered by ${error.delivers}.`, [], "INTERFACE_UNAVAILABLE");
  }
  if (error instanceof RefusedError) return err(refusalText(error.refusal), [], error.refusal.code ?? null);
  if (error instanceof AuthError) return err(error.message, [], "SNOWFLAKE_AUTH");
  if (error instanceof ContractViolationError) return err(`Snowflake's answer didn't match its contract, so nothing is shown. ${error.message}`, [], "CONTRACT_VIOLATION");
  return err(`Unexpected error: ${(error as Error)?.message ?? String(error)}`);
}

export function portFor(ctx: AppContext, session: Session): PersonaPort {
  return ctx.provider.port(session.identity);
}

function record(ctx: AppContext, session: Session, caseId: string | null, input: string, artifact: Artifact): ConsoleEntry {
  const entry: ConsoleEntry = {
    id: randomUUID(),
    at: new Date(ctx.now()).toISOString(),
    case_id: caseId,
    input,
    user: session.identity.user,
    role: session.identity.role,
    artifact,
  };
  ctx.store.addHistory(session, caseId ?? "-", entry);
  return entry;
}

function findAction(view: CaseView, action: AvailableAction["action"]): AvailableAction | undefined {
  return view.viewer.available_actions.find((a) => a.action === action);
}

function unavailable(view: CaseView, action: AvailableAction["action"], what: string): ErrorArtifact | null {
  const a = findAction(view, action);
  if (!a) return err(`Snowflake offers you no way to ${what} on this case (role ${view.viewer.role}).`);
  if (!a.enabled) return err(a.disabled_reason ?? `You can't ${what} on this case right now.`);
  return null;
}

// ---- proof ------------------------------------------------------------------------------

function proofCall(view: CaseView, command: Command): { call: BoundCall } | { error: ErrorArtifact } {
  if (command.verb === "verify") {
    const blocked = unavailable(view, "VERIFY_LEDGER", "verify the ledger");
    if (blocked) return { error: blocked };
    return { call: bindCall("VERIFY_LEDGER", { ledger_table: command.table ?? MAIN_LEDGER }) };
  }
  if (command.verb === "replay") {
    const blocked = unavailable(view, "REPLAY_EVIDENCE", "replay evidence");
    if (blocked) return { error: blocked };
    const packs = findAction(view, "REPLAY_EVIDENCE")!.pack_ids ?? view.analysis.packs.map((p) => p.pack_id);
    const token = command.pack ?? view.case.current_pack_id ?? packs.at(-1);
    if (!token) return { error: err("This case has no sealed evidence pack yet.") };
    const r = resolveId(token, "PACK", packs, "evidence pack");
    if (!r.ok) return { error: err(r.error, r.candidates) };
    return { call: bindCall("REPLAY_EVIDENCE", { pack_id: r.id }) };
  }
  const blocked = unavailable(view, "EXPORT_EVIDENCE_PACK", "export the evidence pack");
  if (blocked) return { error: blocked };
  return { call: bindCall("EXPORT_EVIDENCE_PACK", { case_id: view.case.case_id }) };
}

async function runProof(port: PersonaPort, view: CaseView, command: Command): Promise<Artifact> {
  const prepared = proofCall(view, command);
  if ("error" in prepared) return prepared.error;
  const result = await port.invoke(prepared.call as BoundCall<PersonaCall>);
  if (isRefusal(result)) return err(refusalText(result), [], result.code ?? null);
  return { type: "proof", call: prepared.call.name as PersonaCall, result };
}

// ---- writes (prepare a confirm card) ----------------------------------------------------

type Prepared = { call: BoundCall; summary: string; warnings: string[] } | { error: ErrorArtifact };

/** The verdicts API.DECIDE_APPROVAL accepts. */
const VERDICT = { approve: "APPROVE", choose: "ALTERNATIVE", reject: "REJECT" } as const;

function prepareDecision(view: CaseView, command: Extract<Command, { verb: "approve" | "choose" | "reject" }>): Prepared {
  const actions = view.viewer.available_actions.filter((a) => a.action === "DECIDE_APPROVAL");
  let action: AvailableAction | undefined;
  if (command.approval) {
    const r = resolveId(command.approval, "APR", actions.map((a) => a.approval_id!).filter(Boolean), "approval");
    if (!r.ok) return { error: err(r.error, r.candidates) };
    action = actions.find((a) => a.approval_id === r.id);
  } else {
    const enabled = actions.filter((a) => a.enabled);
    if (enabled.length > 1) return { error: err("More than one approval is yours to decide; name it.", enabled.map((a) => a.approval_id!)) };
    action = enabled[0] ?? actions[0];
  }
  if (!action) return { error: err("There is no approval on this case.") };
  if (!action.enabled) return { error: err(action.disabled_reason ?? "You can't decide this approval.") };
  const verdict = VERDICT[command.verb];
  if (!action.verdicts?.includes(verdict)) return { error: err(`Snowflake doesn't offer ${command.verb} on ${action.approval_id}.`) };
  if (action.reason_required_for?.includes(verdict) && !command.reason) {
    return { error: err(`A reason is required to ${command.verb}. Add reason "…" to the command.`) };
  }
  let chosen: string | null = null;
  if (command.verb === "choose") {
    const r = resolveId(command.option, "OPT", action.choosable_option_ids ?? [], "option you can choose");
    if (!r.ok) return { error: err(`${r.error} Snowflake lets you choose: ${(action.choosable_option_ids ?? []).join(", ") || "none"}.`, r.candidates) };
    chosen = r.id;
  }
  const rec = activeRecommendation(view);
  const recOption = view.options.find((o) => o.option_id === rec?.option_id);
  const chosenOption = view.options.find((o) => o.option_id === chosen);
  const warnings: string[] = [];
  if (action.due_at) warnings.push(`Due ${when(action.due_at)}. After that the approval expires.`);
  if (view.governance.fallback) warnings.push(`If nothing executes by ${when(view.governance.fallback.runs_at)}, Snowflake's watchdog runs the safe fallback: ${view.governance.fallback.label}.`);
  if (command.verb === "reject") warnings.push("Rejecting runs the safe fallback.");
  if (command.verb === "choose") warnings.push("Choosing another option sends it back through policy evaluation.");
  const summary = {
    approve: `Approve ${rec?.rec_id ?? "the recommendation"}: ${recOption?.label ?? rec?.option_id ?? ""}`,
    choose: `Choose ${chosen} instead: ${chosenOption?.label ?? ""}`,
    reject: `Reject ${rec?.rec_id ?? "the recommendation"}`,
  }[command.verb];
  return {
    call: bindCall("DECIDE_APPROVAL", { approval_id: action.approval_id, verdict, chosen_option_id: chosen, reason: command.reason }),
    summary: `${summary} (${action.approval_id})`,
    warnings,
  };
}

function prepareWrite(view: CaseView | null, command: Command): Prepared {
  if (command.verb === "approve" || command.verb === "choose" || command.verb === "reject") return prepareDecision(view!, command);
  if (command.verb === "reverse") {
    const blocked = unavailable(view!, "REVERSE_DECISION", "reverse the decision");
    if (blocked) return { error: blocked };
    const action = findAction(view!, "REVERSE_DECISION")!;
    const rec = command.rec ?? action.rec_id ?? view!.case.current_rec_id;
    if (!rec) return { error: err("There is no executed decision to reverse.") };
    if (!command.reason) return { error: err('A reason is required to reverse a decision. Add reason "…".') };
    return {
      call: bindCall("REVERSE_DECISION", { rec_id: rec, reason: command.reason }),
      summary: `Reverse ${rec} through compensating actions`,
      warnings: ["The original record stays; the ledger shows both the decision and its reversal."],
    };
  }
  if (command.verb === "stop-dispatch") {
    if (view) {
      const blocked = unavailable(view, "EMERGENCY_STOP", "stop dispatch");
      if (blocked) return { error: blocked };
    }
    if (!command.reason) return { error: err('A reason is required for an emergency stop. Add reason "…".') };
    return {
      call: bindCall("EMERGENCY_STOP", { reason: command.reason }),
      summary: "Emergency stop: halt every dispatch to SAP, the TMS, carriers and customers",
      warnings: ["Dispatch stays stopped until a new policy version is activated."],
    };
  }
  return { error: err(`${command.verb} is not a governed write.`) };
}

function issueGrant(ctx: AppContext, session: Session, view: CaseView | null, input: string, prepared: Extract<Prepared, { call: BoundCall }>): ConfirmCard {
  const token = randomBytes(16).toString("hex");
  const expiresAt = ctx.now() + GRANT_TTL_MS;
  const grant: ConfirmGrant = {
    token,
    caseId: view?.case.case_id ?? null,
    call: prepared.call,
    briefHash: view?.case.current_brief_hash ?? null,
    changeToken: view?.change_token ?? null,
    input,
    expiresAt,
    used: false,
  };
  for (const [t, g] of session.grants) if (g.used || g.expiresAt < ctx.now()) session.grants.delete(t);
  session.grants.set(token, grant);
  const params = INTERFACES[prepared.call.name].params;
  return {
    token,
    expires_at: new Date(expiresAt).toISOString(),
    summary: prepared.summary,
    procedure: prepared.call.name,
    statement: prepared.call.statement,
    binds: params.map((name, i) => ({ name, value: prepared.call.binds[i] ?? null })),
    persona: session.identity.persona,
    user: session.identity.user,
    role: session.identity.role,
    case_id: grant.caseId,
    brief_hash: grant.briefHash,
    warnings: prepared.warnings,
    fixture: ctx.config.mode === "fixture",
  };
}

// ---- Analyst ----------------------------------------------------------------------------

async function ask(ctx: AppContext, session: Session, question: string): Promise<Artifact> {
  if (ctx.world) {
    const hit = ctx.world.analyst(question);
    return "answer" in hit ? { type: "analyst", answer: hit.answer, recorded: true } : { type: "analyst_miss", question, recorded_questions: hit.recorded };
  }
  const clients = ctx.provider.analyst(session.identity);
  if (!clients) return err("Cortex Analyst isn't configured for this server.");
  const answer = await answerQuestion({ ...clients, question, executedAs: { user: session.identity.user, role: session.identity.role } });
  return { type: "analyst", answer, recorded: false };
}

// ---- entry points -----------------------------------------------------------------------

export async function runConsole(ctx: AppContext, session: Session, input: string, caseId: string | null): Promise<ConsoleEntry> {
  const text = input.trim().slice(0, 2000);
  const parsed = parseCommand(text);
  if (!parsed.ok) return record(ctx, session, caseId, text, err(parsed.error, parsed.suggestions));
  const command = parsed.command;
  try {
    if (command.verb === "ask") return record(ctx, session, caseId, text, await ask(ctx, session, command.question));
    if (command.verb === "help") return record(ctx, session, caseId, text, helpArtifact(command.topic));
    if (!caseId && command.verb !== "stop-dispatch") {
      return record(ctx, session, caseId, text, err(`Open a case to use ${command.verb}.`));
    }
    const port = portFor(ctx, session);
    const view = caseId ? await port.caseView(caseId) : null;
    if (WRITE_VERBS.has(command.verb)) {
      const prepared = prepareWrite(view, command);
      if ("error" in prepared) return record(ctx, session, caseId, text, prepared.error);
      return record(ctx, session, caseId, text, { type: "confirm", card: issueGrant(ctx, session, view, text, prepared) });
    }
    if (PROOF_VERBS.has(command.verb)) return record(ctx, session, caseId, text, await runProof(port, view!, command));
    return record(ctx, session, caseId, text, readArtifact(command, view!));
  } catch (error) {
    return record(ctx, session, caseId, text, errorArtifact(error));
  }
}

/** Run a confirmed write: the exact stored call, once, if the case hasn't changed since the card. */
export async function confirmGrant(ctx: AppContext, session: Session, token: string): Promise<ConsoleEntry> {
  const grant = session.grants.get(token);
  const label = grant ? `confirm: ${grant.input}` : "confirm";
  if (!grant) return record(ctx, session, null, label, err("This confirmation is unknown, or it belongs to another session. Run the command again."));
  if (grant.used) return record(ctx, session, grant.caseId, label, err("This confirmation was already used."));
  if (grant.expiresAt < ctx.now()) return record(ctx, session, grant.caseId, label, err("This confirmation expired. Run the command again to review the current state."));
  grant.used = true;
  try {
    const port = portFor(ctx, session);
    if (grant.caseId) {
      const view = await port.caseView(grant.caseId);
      if (view.change_token !== grant.changeToken) {
        return record(ctx, session, grant.caseId, label,
          err(`The case changed after you reviewed it (version ${grant.changeToken} is now ${view.change_token}). Review it again before deciding.`, [], "CHANGED_SINCE_REVIEW"));
      }
    }
    const result = await port.invoke(grant.call as BoundCall<PersonaCall>);
    if (isRefusal(result)) return record(ctx, session, grant.caseId, label, err(refusalText(result), [], result.code ?? null));
    const summary = receiptSummary(grant.call.name as PersonaCall, result as unknown as Record<string, unknown>);
    return record(ctx, session, grant.caseId, label, { type: "receipt", call: grant.call.name as PersonaCall, summary, result });
  } catch (error) {
    return record(ctx, session, grant.caseId, label, errorArtifact(error));
  }
}

function receiptSummary(call: PersonaCall, r: Record<string, unknown>): string {
  switch (call) {
    case "DECIDE_APPROVAL": {
      const status = String(r["approval_status"]);
      const entry = r["ledger_seq"] ? `, ledger entry ${r["ledger_seq"]}` : "";
      if (r["replayed"]) return `${r["approval_id"]} was already ${status.toLowerCase()}; Snowflake changed nothing.`;
      if (status === "STALE") return `Snowflake recorded ${r["approval_id"]} as stale${entry}: the Brief or its evidence changed after the approval was requested, so your verdict was not applied.`;
      if (status === "EXPIRED") return `Snowflake recorded ${r["approval_id"]} as expired${entry}: it was past due, so your verdict was not applied.`;
      const state = r["case_state"] ? ` ${STATE_TEXT[String(r["case_state"])] ?? `Case state: ${String(r["case_state"])}.`}` : "";
      return `Snowflake recorded ${r["approval_id"]} as ${status.toLowerCase().replaceAll("_", " ")}${entry}.${state}`;
    }
    case "REVERSE_DECISION":
      return `Snowflake queued ${(r["compensation_mutation_ids"] as string[]).length} compensating action(s), ledger entry ${r["ledger_seq"]}.`;
    case "EMERGENCY_STOP":
      return `Dispatch stopped, ledger entry ${r["ledger_seq"]}. To resume: ${String(r["resume"] ?? "activate a policy version")}.`;
    default:
      return "Done.";
  }
}

export function historyFor(session: Session, caseId: string | null): ConsoleEntry[] {
  return session.history.get(caseId ?? "-") ?? [];
}
