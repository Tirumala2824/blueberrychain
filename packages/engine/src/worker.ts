/**
 * The lifecycle worker (ADR-0004): lease the next step from Snowflake and do exactly that
 * step. Snowflake's case state machine decides what comes next (API.CLAIM_WORK's `next`),
 * including which agent to invoke; the worker holds no routing logic. Every procedure it
 * calls is idempotent and leases expire, so the worker is safe to stop or crash at any point.
 *
 * - ADVANCE: API.ADVANCE_CASE(case, expected_state) runs the deterministic stages.
 * - ENGINE / EXECUTE_PLAN: API.EXECUTE_PLAN(case, rec) turns the approved bundle into
 *   mutations through the gateway; the dispatcher carries them out.
 * - AGENT: START_AGENT_RUN, the agent, END_AGENT_RUN (WP8a, not delivered yet).
 */

import { InterfaceUnavailableError, isRefusal, refusalText, type ClaimWorkResult, type EnginePort } from "@blueberrychain/bbc-api";
import type { AgentProvider } from "./agents.js";
import type { LogFields, Logger } from "./log.js";
import type { TraceHub } from "./relay.js";

export interface WorkerOptions {
  id: string;
  port: EnginePort;
  provider: AgentProvider;
  hub: TraceHub;
  log: Logger;
  leaseS?: number;
  idleMs?: number;
  /** Back-off when an interface isn't delivered yet (don't crash-loop). */
  missingMs?: number;
  errorMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type StepResult = "idle" | "advanced" | "stale" | "executed" | "agent" | "refused" | "missing" | "error";

type Leased = Extract<ClaimWorkResult, { next: unknown }>;
const AGENTS = ["EXCURSION_FORENSICS", "RECOVERY_STRATEGIST", "CLAIMS_RECOVERY", "EVIDENCE_AUDITOR"] as const;
type AgentName = (typeof AGENTS)[number];
const isAgent = (v: string | undefined): v is AgentName => (AGENTS as readonly string[]).includes(v ?? "");

export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

export class Worker {
  constructor(private readonly o: WorkerOptions) {}

  /** One lease, one step. */
  async step(signal: AbortSignal = new AbortController().signal): Promise<StepResult> {
    const { port, log, id } = this.o;
    try {
      const claimed = await port.claimWork(id, this.o.leaseS ?? 120);
      if (isRefusal(claimed)) {
        log("warn", "claim_refused", { worker_id: id, error: refusalText(claimed) });
        return "refused";
      }
      if (claimed.case_id === null) return "idle";
      const work = claimed as Leased;
      const { next } = work;
      const ctx: LogFields = { worker_id: id, case_id: work.case_id, state: work.state, state_version: work.state_version, kind: next.kind, target: next.target ?? null };
      switch (next.kind) {
        case "ADVANCE":
          return await this.advance(work, ctx);
        case "ENGINE":
          return await this.execute(work, ctx);
        case "AGENT":
          return await this.agent(work, ctx, signal);
        default:
          // CLAIM_WORK never leases a case that waits for a person; if it ever does, leave it.
          log("warn", "unexpected_step", ctx);
          return "idle";
      }
    } catch (error) {
      if (error instanceof InterfaceUnavailableError) {
        log("warn", "interface_missing", { worker_id: id, interface: error.interfaceName, delivers: error.delivers });
        return "missing";
      }
      log("error", "worker_error", { worker_id: id, error: (error as Error).message.slice(0, 300) });
      return "error";
    }
  }

  private async advance(work: Leased, ctx: LogFields): Promise<StepResult> {
    const t0 = Date.now();
    const r = await this.o.port.advanceCase(work.case_id, work.next.expected_state);
    if (isRefusal(r)) {
      this.o.log("warn", "advance_refused", { ...ctx, error: refusalText(r) });
      return "refused";
    }
    if (r.status === "STALE") {
      this.o.log("info", "advance_stale", { ...ctx, now: r.state });
      return "stale";
    }
    this.o.log("info", "advanced", {
      ...ctx, from: r.from, to_state: r.state, steps: r.steps.map((s) => s.step).join(","), waiting_for: r.waiting_for.join(":") || null, duration_ms: Date.now() - t0,
    });
    return "advanced";
  }

  private async execute(work: Leased, ctx: LogFields): Promise<StepResult> {
    if (work.next.target !== "EXECUTE_PLAN") {
      this.o.log("error", "unknown_engine_step", ctx);
      return "error";
    }
    if (!work.rec_id) {
      // EXECUTE_PLAN needs the recommendation; the engine role can't read DECISION.CASES (docs/frontend-spec.md, requests).
      this.o.log("warn", "interface_gap", { ...ctx, interface: "CLAIM_WORK", missing: "rec_id" });
      return "missing";
    }
    const t0 = Date.now();
    const r = await this.o.port.executePlan(work.case_id, work.rec_id);
    if (isRefusal(r)) {
      this.o.log("warn", "execute_plan_refused", { ...ctx, rec_id: work.rec_id, error: refusalText(r) });
      return "refused";
    }
    this.o.log("info", "plan_executed", {
      ...ctx, rec_id: work.rec_id, plan_id: r.plan_id, atomicity: r.atomicity,
      steps: r.steps.map((s) => `${s.step_seq}:${s.action_type}:${s.mutation_status ?? s.status}`).join(","), duration_ms: Date.now() - t0,
    });
    return "executed";
  }

  private async agent(work: Leased, ctx: LogFields, signal: AbortSignal): Promise<StepResult> {
    const { port, log, provider, hub } = this.o;
    if (!isAgent(work.next.target)) {
      log("error", "unknown_agent", ctx);
      return "error";
    }
    if (!work.decision_point) {
      log("warn", "interface_gap", { ...ctx, interface: "CLAIM_WORK", missing: "decision_point" });
      return "missing";
    }
    const agentName = work.next.target;
    const started = await port.startAgentRun({ case_id: work.case_id, agent: agentName, decision_point: work.decision_point, provider: provider.name, model: null });
    if (isRefusal(started)) {
      log("warn", "agent_run_refused", { ...ctx, error: refusalText(started) });
      return "refused";
    }
    log("info", "agent_run_started", { ...ctx, run_id: started.run_id, agent: started.agent, model: started.model, budget: started.call_budget });
    let record;
    try {
      record = await provider.run(started, (e) => hub.publish(e), signal);
    } finally {
      hub.end(started.run_id);
    }
    const ended = await port.endAgentRun(started.run_id, record);
    log(record.status === "COMPLETED" ? "info" : "warn", "agent_run_ended", {
      ...ctx, run_id: started.run_id, run_status: record.status, events: record.trace.length, latency_ms: record.latency_ms,
      error: record.error?.code ?? null, case_state: isRefusal(ended) ? null : ended.case_state,
    });
    return "agent";
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.o.sleep ?? abortableSleep;
    while (!signal.aborted) {
      const r = await this.step(signal);
      const base = r === "idle" || r === "refused" ? this.o.idleMs ?? 3000 : r === "missing" ? this.o.missingMs ?? 300_000 : r === "error" ? this.o.errorMs ?? 10_000 : 0;
      if (base) await sleep(base + Math.floor(Math.random() * Math.min(1000, base / 4)), signal);
    }
  }
}
