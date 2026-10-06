/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * The RECORD argument of API.END_AGENT_RUN(run_id, record): how the run ended and its full normalized trace. The engine never decides what happens next; Snowflake does (fail closed).
 */
export interface AgentRunRecord {
  status: "COMPLETED" | "FAILED" | "EXPIRED";
  /**
   * @maxItems 2000
   */
  trace: AgentTraceEvent[];
  truncated: boolean;
  latency_ms: number;
  tokens: {
    input?: number;
    output?: number;
  } | null;
  error: Error | null;
  provider_request_id: string | null;
}
/**
 * One normalized event of a Cortex Agent run, as the engine parsed it from the agent's SSE stream. Streamed live to the control tower (unrecorded) and recorded through API.END_AGENT_RUN. Agent text is untrusted output: shown, never executed.
 */
export interface AgentTraceEvent {
  run_id: string;
  seq: number;
  at: string;
  kind: "STATUS" | "THINKING" | "TEXT" | "TOOL_USE" | "TOOL_RESULT" | "ERROR" | "DONE" | "OTHER";
  text?: string;
  tool?: {
    name: string;
    tool_use_id: string;
  };
  tool_result?: {
    tool_use_id: string;
    status: string;
    /**
     * @maxItems 500
     */
    evidence_ids: string[];
  };
  error?: Error;
  /**
   * The provider's SSE event name, kept for OTHER events.
   */
  raw_type?: string;
}
export interface Error {
  code: string;
  path?: string;
  message: string;
}
