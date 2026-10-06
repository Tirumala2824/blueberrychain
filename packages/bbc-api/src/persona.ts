/**
 * The persona port: what a signed-in person (through the control tower's server) can
 * read and do. One port instance = one Snowflake identity (that person's own PAT), so
 * every approval is attributed by Snowflake to CURRENT_USER(), never by the app.
 */

import type {
  ApiActivePolicy,
  ApiCaseView,
  ApiDecideApprovalResult,
  ApiEmergencyStopResult,
  ApiExportResult,
  ApiInboxRow,
  ApiReplayResult,
  ApiReverseDecisionResult,
  ApiVerifyLedgerResult,
  SqlApiClient,
} from "@blueberrychain/shared";
import { RefusedError, isRefusal, mapSnowflakeError } from "./errors.js";
import { INTERFACES, type BoundCall, type InterfaceName, type PersonaWrite, type ProofCall } from "./interfaces.js";
import { checked } from "./validate.js";

export type CaseView = ApiCaseView.CaseView;
export type Viewer = ApiCaseView.Viewer;
export type AvailableAction = ApiCaseView.AvailableAction;
export type InboxRow = ApiInboxRow.CaseInboxRow;
export type ActivePolicy = ApiActivePolicy.ActivePolicy;
export type DecideApprovalResult = ApiDecideApprovalResult.DECIDE_APPROVALResult;
export type ReverseDecisionResult = ApiReverseDecisionResult.REVERSE_DECISIONResult;
export type EmergencyStopResult = ApiEmergencyStopResult.EMERGENCY_STOPResult;
export type VerifyLedgerResult = ApiVerifyLedgerResult.VERIFY_LEDGERResult;
export type ReplayResult = ApiReplayResult.REPLAY_EVIDENCEResult;
export type ExportResult = ApiExportResult.EXPORT_EVIDENCE_PACKResult;

export type PersonaCall = PersonaWrite | ProofCall;

export interface PersonaCallResults {
  DECIDE_APPROVAL: DecideApprovalResult;
  REVERSE_DECISION: ReverseDecisionResult;
  EMERGENCY_STOP: EmergencyStopResult;
  VERIFY_LEDGER: VerifyLedgerResult;
  REPLAY_EVIDENCE: ReplayResult;
  EXPORT_EVIDENCE_PACK: ExportResult;
}

export interface Whoami {
  user: string;
  role: string;
}

export interface PersonaPort {
  readonly mode: "live" | "fixture";
  whoami(): Promise<Whoami>;
  inbox(): Promise<InboxRow[]>;
  caseView(caseId: string): Promise<CaseView>;
  /** The active policy document (governance admin only; null if none is active). */
  activePolicy(): Promise<ActivePolicy | null>;
  /** Run one governed call exactly as bound (the statement and binds shown on the confirm card). */
  invoke<N extends PersonaCall>(call: BoundCall & { name: N }): Promise<PersonaCallResults[N]>;
}

async function guarded<T>(name: InterfaceName, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw mapSnowflakeError(name, error);
  }
}

/** The live port: every method is one fixed statement from INTERFACES, run as the client's identity. */
export function createSqlPersonaPort(client: SqlApiClient): PersonaPort {
  return {
    mode: "live",

    whoami: () =>
      guarded("WHOAMI", async () => {
        const [row] = await client.queryRows(INTERFACES.WHOAMI.statement, [], { queryTag: "whoami" });
        return { user: String(row?.["user_name"] ?? ""), role: String(row?.["role_name"] ?? "") };
      }),

    inbox: () =>
      guarded("V_CASE_INBOX", async () => {
        const rows = await client.queryRows(INTERFACES.V_CASE_INBOX.statement, [], { queryTag: "inbox" });
        return rows.map((row) => checked<InboxRow>("V_CASE_INBOX", INTERFACES.V_CASE_INBOX.resultSchema, row));
      }),

    caseView: (caseId) =>
      guarded("GET_CASE_VIEW", async () => {
        const view = await client.callJson(INTERFACES.GET_CASE_VIEW.statement, [caseId], { queryTag: "case_view" });
        if (isRefusal(view)) throw new RefusedError("GET_CASE_VIEW", checked("GET_CASE_VIEW", "api/refusal.json", view));
        return checked<CaseView>("GET_CASE_VIEW", INTERFACES.GET_CASE_VIEW.resultSchema, view);
      }),

    activePolicy: () =>
      guarded("ACTIVE_POLICY", async () => {
        const [row] = await client.queryRows(INTERFACES.ACTIVE_POLICY.statement, [], { queryTag: "policy" });
        return row ? checked<ActivePolicy>("ACTIVE_POLICY", INTERFACES.ACTIVE_POLICY.resultSchema, row) : null;
      }),

    invoke: <N extends PersonaCall>(call: BoundCall & { name: N }) =>
      guarded(call.name, async () => {
        const spec = INTERFACES[call.name];
        if (call.statement !== spec.statement) throw new Error(`${call.name}: statement does not match the interface table`);
        const result = await client.callJson(call.statement, call.binds, { queryTag: call.name.toLowerCase() });
        return checked<PersonaCallResults[N]>(call.name, spec.resultSchema, result);
      }),
  };
}
