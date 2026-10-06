/**
 * The lifecycle worker (ADR-0004): lease the next step from Snowflake and do exactly that
 * step. Snowflake's case state machine decides what comes next, including which agent
 * to invoke; the worker holds no routing logic. Every procedure it calls is idempotent,
 * leases expire, so the worker is safe to stop or crash at any point.
 */

import { InterfaceUnavailableError, isRefusal, type EnginePort } from "@blueberrychain/bbc-api";
import type { AgentProvider } from "./agents.js";
import type { Logger } from "./log.js";
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

export type StepResult = "idle" | "advanced" | "agent" | "refused" | "missing" | "error";

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
        log("warn", "claim_refused", { worker_id: id, code: claimed.code ?? null, error: claimed.errors[0] ?? null });
        return "refused";
      }
      const work = claimed.work;
      if (!work) return "idle";
      const ctx = { worker_id: id, case_id: work.case_id, state: work.state, step: work.step, attempt: work.attempt };
      if (work.step === "ADVANCE") {
        const t0 = Date.now();
        const r = await port.advanceCase(work.case_id, work.state);
        if (isRefusal(r)) {
          log("warn", "advance_refused", { ...ctx, code: r.code ?? null, error: r.errors[0] ?? null });
          return "refused";
        }
        log("info", "advanced", { ...ctx, to_state: r.to_state, transitions: r.transitions.length, next: r.next, duration_ms: Date.now() - t0 });
        return "advanced";
      }
      if (!work.agent) {
        log("error", "agent_step_without_agent", ctx);
        return "error";
      }
      const started = await port.startAgentRun({ case_id: work.case_id, agent: work.agent, decision_point: work.decision_point, provider: this.o.provider.name, model: null });
      if (isRefusal(started)) {
        log("warn", "agent_run_refused", { ...ctx, agent: work.agent, code: started.code ?? null, error: started.errors[0] ?? null });
        return "refused";
      }
      log("info", "agent_run_started", { ...ctx, run_id: started.run_id, agent: started.agent, model: started.model, budget: started.call_budget });
      let record;
      try {
        record = await this.o.provider.run(started, (e) => this.o.hub.publish(e), signal);
      } finally {
        this.o.hub.end(started.run_id);
      }
      const ended = await port.endAgentRun(started.run_id, record);
      log(record.status === "COMPLETED" ? "info" : "warn", "agent_run_ended", {
        ...ctx, run_id: started.run_id, run_status: record.status, events: record.trace.length, latency_ms: record.latency_ms,
        error: record.error?.code ?? null, case_state: isRefusal(ended) ? null : ended.case_state,
      });
      return "agent";
    } catch (error) {
      if (error instanceof InterfaceUnavailableError) {
        log("warn", "interface_missing", { worker_id: id, interface: error.interfaceName, delivers: error.delivers });
        return "missing";
      }
      log("error", "worker_error", { worker_id: id, error: (error as Error).message.slice(0, 300) });
      return "error";
    }
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
