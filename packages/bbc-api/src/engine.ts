/**
 * The engine port: the lifecycle worker's and dispatcher's only way into Snowflake,
 * as BBC_ENGINE_SVC. The engine holds no table privileges; if a procedure doesn't
 * expose something, the engine can't do it (ADR-0004).
 */

import type {
  ApiAckMutationResult,
  ApiAdvanceCaseResult,
  ApiAgentRunRecord,
  ApiClaimWorkResult,
  ApiDispatchReport,
  ApiEndAgentRunResult,
  ApiNextActionsResult,
  ApiStartAgentRunResult,
  SqlApiClient,
} from "@blueberrychain/shared";
import { mapSnowflakeError } from "./errors.js";
import { INTERFACES, bindCall, type InterfaceName } from "./interfaces.js";
import { checked } from "./validate.js";

export type ClaimWorkResult = ApiClaimWorkResult.CLAIM_WORKResult;
export type AdvanceCaseResult = ApiAdvanceCaseResult.ADVANCE_CASEResult;
export type StartAgentRunResult = ApiStartAgentRunResult.START_AGENT_RUNResult;
export type EndAgentRunResult = ApiEndAgentRunResult.END_AGENT_RUNResult;
export type AgentRunRecord = ApiAgentRunRecord.AgentRunRecord;
export type NextActionsResult = ApiNextActionsResult.NEXT_ACTIONSResult;
export type DispatchReport = ApiDispatchReport.DispatchReport;
export type AckMutationResult = ApiAckMutationResult.ACK_MUTATIONResult;

export interface StartAgentRunArgs {
  case_id: string;
  agent: string;
  decision_point: "D1" | "D2";
  provider: string;
  model: string | null;
}

export interface EnginePort {
  claimWork(workerId: string, leaseS: number): Promise<ClaimWorkResult>;
  advanceCase(caseId: string, expectedState: string): Promise<AdvanceCaseResult>;
  startAgentRun(args: StartAgentRunArgs): Promise<StartAgentRunResult>;
  endAgentRun(runId: string, record: AgentRunRecord): Promise<EndAgentRunResult>;
  nextActions(dispatcherId: string, limit: number): Promise<NextActionsResult>;
  ackMutation(mutationId: string, report: DispatchReport): Promise<AckMutationResult>;
}

export function createSqlEnginePort(client: SqlApiClient): EnginePort {
  async function call<T>(name: InterfaceName, args: Record<string, unknown>): Promise<T> {
    const spec = INTERFACES[name];
    const bound = bindCall(name, args);
    try {
      const result = await client.callJson(bound.statement, bound.binds, { queryTag: name.toLowerCase() });
      return checked<T>(name, spec.resultSchema as string, result);
    } catch (error) {
      throw mapSnowflakeError(name, error);
    }
  }

  return {
    claimWork: (workerId, leaseS) => call("CLAIM_WORK", { worker_id: workerId, lease_s: leaseS }),
    advanceCase: (caseId, expectedState) => call("ADVANCE_CASE", { case_id: caseId, expected_state: expectedState }),
    startAgentRun: (args) => call("START_AGENT_RUN", { ...args }),
    endAgentRun: async (runId, record) =>
      call("END_AGENT_RUN", { run_id: runId, record: checked("END_AGENT_RUN", "api/agent_run_record.json", record) }),
    nextActions: (dispatcherId, limit) => call("NEXT_ACTIONS", { dispatcher_id: dispatcherId, limit }),
    ackMutation: async (mutationId, report) =>
      call("ACK_MUTATION", { mutation_id: mutationId, report: checked("ACK_MUTATION", "api/dispatch_report.json", report) }),
  };
}
