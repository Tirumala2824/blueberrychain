/**
 * Agent invocation. The engine never decides when an agent runs or what it may do:
 * Snowflake's CLAIM_WORK says which agent, START_AGENT_RUN opens a case-scoped, budgeted
 * capability and returns the exact message, and the agent's tools run under
 * BBC_AGENT_RUNTIME in Snowflake. The engine streams the run, normalizes the events for
 * the live trace, and reports how it ended (END_AGENT_RUN). It fails closed: no retries,
 * no synthesized submissions.
 */

import type { AgentRunRecord, StartAgentRunResult } from "@blueberrychain/bbc-api";
import { readSse, type SseEvent } from "@blueberrychain/bbc-api";

export type TraceEvent = AgentRunRecord["trace"][number];
type Started = Extract<StartAgentRunResult, { status: "OK" }>;

export interface AgentProvider {
  readonly name: string;
  run(start: Started, onEvent: (event: TraceEvent) => void, signal?: AbortSignal): Promise<AgentRunRecord>;
}

const EVIDENCE = /EV:(?:PACK|TEL|DOC|SIG|OPT|PREC|CTR|PARTY|RSP|MV|LOSS):[^\s"'\\,\]}]{1,200}/g;
const MAX_TRACE = 2000;
const MAX_TEXT = 20_000;

/** Cortex Agent SSE events -> the normalized trace (contracts/schemas/api/agent_trace_event.json). */
export class TraceBuilder {
  readonly trace: TraceEvent[] = [];
  truncated = false;
  final = false;
  error: { code: string; message: string } | null = null;
  tokens: { input?: number; output?: number } | null = null;
  requestId: string | null = null;
  private pending: { kind: "TEXT" | "THINKING"; text: string } | null = null;

  constructor(
    private readonly runId: string,
    private readonly onEvent: (e: TraceEvent) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private push(e: Omit<TraceEvent, "run_id" | "seq" | "at">): void {
    if (this.trace.length >= MAX_TRACE) {
      this.truncated = true;
      return;
    }
    const event = { run_id: this.runId, seq: this.trace.length, at: this.now().toISOString(), ...e } as TraceEvent;
    this.trace.push(event);
    this.onEvent(event);
  }

  /** Deltas are merged into one TEXT / THINKING event, emitted when anything else arrives. */
  private flush(): void {
    if (!this.pending) return;
    const text = this.pending.text.slice(0, MAX_TEXT);
    if (this.pending.text.length > MAX_TEXT) this.truncated = true;
    this.push({ kind: this.pending.kind, text });
    this.pending = null;
  }

  private delta(kind: "TEXT" | "THINKING", text: string): void {
    if (this.pending && this.pending.kind !== kind) this.flush();
    this.pending ??= { kind, text: "" };
    this.pending.text += text;
  }

  handle(sse: SseEvent): void {
    let data: Record<string, unknown> = {};
    try {
      data = sse.data && sse.data !== "[DONE]" ? (JSON.parse(sse.data) as Record<string, unknown>) : {};
    } catch {
      data = { raw: sse.data };
    }
    switch (sse.event) {
      case "response.text.delta":
        return this.delta("TEXT", String(data["text"] ?? ""));
      case "response.thinking.delta":
        return this.delta("THINKING", String(data["text"] ?? ""));
      case "response.text":
      case "response.thinking":
        return;
    }
    this.flush();
    switch (sse.event) {
      case "response.status":
        return this.push({ kind: "STATUS", text: String(data["message"] ?? data["status"] ?? "").slice(0, 500) });
      case "response.tool_use":
        return this.push({ kind: "TOOL_USE", tool: { name: String(data["name"] ?? "?").slice(0, 128), tool_use_id: String(data["tool_use_id"] ?? "").slice(0, 128) } });
      case "response.tool_result": {
        const ids = [...new Set(JSON.stringify(data["content"] ?? data).match(EVIDENCE) ?? [])].slice(0, 500);
        return this.push({
          kind: "TOOL_RESULT",
          tool_result: { tool_use_id: String(data["tool_use_id"] ?? "").slice(0, 128), status: String(data["status"] ?? "unknown").slice(0, 64), evidence_ids: ids },
        });
      }
      case "response": {
        this.final = true;
        const usage = (data["usage"] ?? (data["metadata"] as Record<string, unknown> | undefined)?.["usage"]) as Record<string, number> | undefined;
        if (usage) this.tokens = { ...(usage["input_tokens"] !== undefined ? { input: usage["input_tokens"] } : {}), ...(usage["output_tokens"] !== undefined ? { output: usage["output_tokens"] } : {}) };
        if (typeof data["request_id"] === "string") this.requestId = data["request_id"];
        return this.push({ kind: "DONE" });
      }
      case "error": {
        this.error = { code: String(data["code"] ?? "AGENT_ERROR").replace(/[^A-Z0-9_]/gi, "_").toUpperCase(), message: String(data["message"] ?? "agent error").slice(0, 1000) };
        return this.push({ kind: "ERROR", error: this.error });
      }
      default:
        return this.push({ kind: "OTHER", raw_type: sse.event.slice(0, 128) });
    }
  }

  finish(): void {
    this.flush();
  }
}

export interface CortexAgentConfig {
  account: string;
  host?: string;
  /** BBC_AGENT_SVC's PAT: agents take their permissions from this user's default role. */
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Cortex Agents over REST (ADR-0004): POST …/agents/<name>:run, read as server-sent events. */
export class CortexAgentProvider implements AgentProvider {
  readonly name = "cortex-agent";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CortexAgentConfig) {
    if (!config.token) throw new Error("CortexAgentProvider: BBC_AGENT_PAT is required");
    this.fetchImpl = config.fetch ?? fetch;
  }

  async run(start: Started, onEvent: (e: TraceEvent) => void, signal?: AbortSignal): Promise<AgentRunRecord> {
    const [db, schema, name] = start.agent_fqn.split(".") as [string, string, string];
    const url = `https://${this.config.host ?? `${this.config.account}.snowflakecomputing.com`}/api/v2/databases/${db}/schemas/${schema}/agents/${name}:run`;
    const began = Date.now();
    const budgetMs = Math.max(1000, Math.min(this.config.timeoutMs ?? 300_000, Date.parse(start.expires_at) - Date.now()));
    const timeout = AbortSignal.timeout(budgetMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const builder = new TraceBuilder(start.run_id, onEvent, this.config.now);
    const record = (status: AgentRunRecord["status"], error: AgentRunRecord["error"]): AgentRunRecord => {
      builder.finish();
      return {
        status, trace: builder.trace, truncated: builder.truncated, latency_ms: Date.now() - began,
        tokens: builder.tokens, error, provider_request_id: builder.requestId,
      };
    };
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: start.message }] }] }),
        signal: combined,
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        return record("FAILED", { code: `AGENT_HTTP_${response.status}`, message: text.slice(0, 500) || response.statusText });
      }
      for await (const event of readSse(response.body)) builder.handle(event);
      if (builder.error) return record("FAILED", builder.error);
      if (!builder.final) return record("FAILED", { code: "STREAM_ENDED", message: "the stream ended before a final response" });
      return record("COMPLETED", null);
    } catch (error) {
      if (timeout.aborted) return record("EXPIRED", { code: "RUN_EXPIRED", message: `no final response within ${budgetMs} ms` });
      if (signal?.aborted) return record("FAILED", { code: "SHUTDOWN", message: "the engine stopped during the run" });
      return record("FAILED", { code: "AGENT_TRANSPORT", message: (error as Error).message.slice(0, 500) });
    }
  }
}
