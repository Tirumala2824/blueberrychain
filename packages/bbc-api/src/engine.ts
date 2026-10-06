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
  ApiEndAgentRunResult,
  ApiExecutePlanResult,
  ApiMutationAck,
  ApiNextActionsResult,
  ApiStartAgentRunResult,
  SqlApiClient,
} from "@blueberrychain/shared";
import { mapSnowflakeError } from "./errors.js";
import { INTERFACES, bindCall, type InterfaceName } from "./interfaces.js";
import { checked } from "./validate.js";

export type ClaimWorkResult = ApiClaimWorkResult.CLAIM_WORKResult;
export type AdvanceCaseResult = ApiAdvanceCaseResult.ADVANCE_CASEResult;
export type ExecutePlanResult = ApiExecutePlanResult.EXECUTE_PLANResult;
export type StartAgentRunResult = ApiStartAgentRunResult.START_AGENT_RUNResult;
export type EndAgentRunResult = ApiEndAgentRunResult.END_AGENT_RUNResult;
export type AgentRunRecord = ApiAgentRunRecord.AgentRunRecord;
export type NextActionsResult = ApiNextActionsResult.NEXT_ACTIONSResult;
/** What the dispatcher observed at the target; Snowflake decides the mutation's status from it. */
export type MutationAck = ApiMutationAck.MutationACK;
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
  executePlan(caseId: string, recId: string): Promise<ExecutePlanResult>;
  startAgentRun(args: StartAgentRunArgs): Promise<StartAgentRunResult>;
  endAgentRun(runId: string, record: AgentRunRecord): Promise<EndAgentRunResult>;
  nextActions(dispatcherId: string, maxActions: number, leaseS: number): Promise<NextActionsResult>;
  ackMutation(mutationId: string, attempt: number, ack: MutationAck): Promise<AckMutationResult>;
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
    executePlan: (caseId, recId) => call("EXECUTE_PLAN", { case_id: caseId, rec_id: recId }),
    startAgentRun: (args) => call("START_AGENT_RUN", { ...args }),
    endAgentRun: async (runId, record) =>
      call("END_AGENT_RUN", { run_id: runId, record: checked("END_AGENT_RUN", "api/agent_run_record.json", record) }),
    nextActions: (dispatcherId, maxActions, leaseS) =>
      call("NEXT_ACTIONS", { dispatcher_id: dispatcherId, max_actions: maxActions, lease_s: leaseS }),
    ackMutation: async (mutationId, attempt, ack) =>
      call("ACK_MUTATION", { mutation_id: mutationId, attempt, ack: checked("ACK_MUTATION", "api/mutation_ack.json", ack) }),
  };
}
