/**
 * The dispatcher (ADR-0004): carry out mutations Snowflake's gateway already authorized,
 * and report exactly what the target did. For each leased mutation:
 *
 * 1. a retry first asks the target what happened to the key (never resend blind);
 * 2. read the target, and abort without writing if it no longer matches expected_before;
 * 3. execute with the idempotency key; on a timeout or network error, ask for status
 *    instead of resending, and report RETRY if the outcome is still unknown;
 * 4. read the target again and verify expected_after.
 *
 * Snowflake re-checks the report in ACK_MUTATION and decides what happens next.
 * Writes to the same target entity are serialized.
 */

import { isRefusal, type DispatchReport, type EnginePort, type NextActionsResult } from "@blueberrychain/bbc-api";
import { TargetRejectedError, type ActionHandler } from "@blueberrychain/connector-sdk";
import type { Logger } from "./log.js";
import { abortableSleep } from "./worker.js";

type Leased = Extract<NextActionsResult, { status: "OK" }>["items"][number];
type Intent = Leased["intent"];
type AnyHandler = ActionHandler<never>;

/** The first field where `observed` differs from `expected` (keys the target doesn't report are skipped). */
export function firstMismatch(expected: Record<string, unknown>, observed: Record<string, unknown>): { path: string; expected: unknown; observed: unknown } | null {
  for (const [k, want] of Object.entries(expected)) {
    if (!(k in observed)) continue;
    const got = observed[k];
    const same = typeof want === "number" && typeof got === "number" ? Math.abs(want - got) <= 1e-6 * Math.max(1, Math.abs(want)) : JSON.stringify(want) === JSON.stringify(got);
    if (!same) return { path: `/${k}`, expected: want, observed: got };
  }
  return null;
}

export class HandlerRegistry {
  private readonly byKey = new Map<string, AnyHandler>();

  constructor(handlers: ActionHandler<never>[]) {
    for (const h of handlers) for (const t of h.actionTypes) this.byKey.set(`${h.targetSystem}:${t}`, h);
  }

  find(intent: Intent): AnyHandler | undefined {
    return this.byKey.get(`${intent.target_system}:${intent.action_type}`);
  }

  supported(): string[] {
    return [...this.byKey.keys()].sort();
  }
}

export interface DispatcherOptions {
  id: string;
  port: EnginePort;
  registry: HandlerRegistry;
  log: Logger;
  batch?: number;
  executeTimeoutMs?: number;
  idleMs?: number;
  missingMs?: number;
  now?: () => Date;
}

const timeoutAfter = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`target did not answer within ${ms} ms`)), ms))]);

export class Dispatcher {
  private readonly busy = new Map<string, Promise<void>>();

  constructor(private readonly o: DispatcherOptions) {}

  private now(): string {
    return (this.o.now?.() ?? new Date()).toISOString();
  }

  /** Carry out one leased mutation and describe what the target did. */
  async dispatchOne(item: Leased): Promise<DispatchReport> {
    const intent = item.intent;
    const key = item.idempotency_key;
    const started = this.now();
    const base = { dispatcher_id: this.o.id, attempt: item.attempt, started_at: started };
    const report = (r: Omit<DispatchReport, "dispatcher_id" | "attempt" | "started_at" | "finished_at">): DispatchReport => ({ ...base, ...r, finished_at: this.now() });
    const handler = this.o.registry.find(intent) as ActionHandler<Intent> | undefined;
    if (!handler) {
      return report({ outcome: "FAILED", external_ref: null, observed_before: null, observed_after: null, target_status: null, target_response: null,
        error: { code: "NO_HANDLER", message: `no handler for ${intent.action_type} in ${intent.target_system}` } });
    }
    const verify = async (externalRef: string, before: Record<string, unknown> | null, response: unknown, targetStatus: DispatchReport["target_status"]): Promise<DispatchReport> => {
      const after = await handler.readAfter(intent, externalRef);
      const miss = firstMismatch(intent.expected_after as Record<string, unknown>, after);
      return report({
        outcome: miss ? "FAILED" : "VERIFIED", external_ref: externalRef, observed_before: before, observed_after: after, target_status: targetStatus, target_response: response ?? null,
        error: miss ? { code: "POSTCONDITION_MISMATCH", path: miss.path, message: `expected ${JSON.stringify(miss.expected)}, observed ${JSON.stringify(miss.observed)}` } : null,
      });
    };
    try {
      if (item.attempt > 1) {
        const st = await handler.status(intent, key);
        if (st.state === "APPLIED" && st.externalRef) return await verify(st.externalRef, null, st.detail ?? null, "APPLIED");
        if (st.state === "FAILED") {
          return report({ outcome: "FAILED", external_ref: st.externalRef ?? null, observed_before: null, observed_after: null, target_status: "FAILED", target_response: st.detail ?? null,
            error: { code: "TARGET_FAILED", message: "the target reports this key as failed" } });
        }
      }
      const before = await handler.readBefore(intent);
      const drift = firstMismatch(intent.expected_before as Record<string, unknown>, before);
      if (drift) {
        return report({ outcome: "ABORTED_PRECONDITION", external_ref: null, observed_before: before, observed_after: null, target_status: null, target_response: null,
          error: { code: "PRECONDITION_DRIFT", path: drift.path, message: `expected ${JSON.stringify(drift.expected)}, observed ${JSON.stringify(drift.observed)}` } });
      }
      let executed: { externalRef: string; response: unknown };
      try {
        executed = await timeoutAfter(handler.execute(intent, key), this.o.executeTimeoutMs ?? 30_000);
      } catch (error) {
        if (error instanceof TargetRejectedError) {
          return report({ outcome: "FAILED", external_ref: null, observed_before: before, observed_after: null, target_status: "FAILED", target_response: null,
            error: { code: error.code.replace(/[^A-Z0-9_]/g, "_"), message: error.message.slice(0, 1000) } });
        }
        // Outcome unknown: ask, never resend in the same attempt.
        const st = await handler.status(intent, key).catch(() => ({ state: "UNKNOWN" as const }));
        if (st.state === "APPLIED" && "externalRef" in st && st.externalRef) return await verify(st.externalRef, before, null, "APPLIED");
        return report({ outcome: "RETRY", external_ref: null, observed_before: before, observed_after: null, target_status: st.state, target_response: null,
          error: { code: "OUTCOME_UNKNOWN", message: (error as Error).message.slice(0, 1000) } });
      }
      return await verify(executed.externalRef, before, executed.response, "APPLIED");
    } catch (error) {
      return report({ outcome: "RETRY", external_ref: null, observed_before: null, observed_after: null, target_status: "UNKNOWN", target_response: null,
        error: { code: "TARGET_UNREACHABLE", message: (error as Error).message.slice(0, 1000) } });
    }
  }

  private async handle(item: Leased): Promise<void> {
    const t0 = Date.now();
    const report = await this.dispatchOne(item);
    const ack = await this.o.port.ackMutation(item.mutation_id, report);
    this.o.log(report.outcome === "VERIFIED" ? "info" : "warn", "mutation_dispatched", {
      dispatcher_id: this.o.id, mutation_id: item.mutation_id, action_type: item.intent.action_type, target_system: item.intent.target_system,
      attempt: item.attempt, outcome: report.outcome, error: report.error?.code ?? null, external_ref: report.external_ref,
      ack: isRefusal(ack) ? `refused:${ack.code ?? ""}` : ack.mutation_status, duration_ms: Date.now() - t0,
    });
  }

  /** Lease a batch and dispatch it: in parallel across targets, one at a time per target entity. */
  async tick(): Promise<number> {
    const leased = await this.o.port.nextActions(this.o.id, this.o.batch ?? 10);
    if (isRefusal(leased)) {
      this.o.log("warn", "next_actions_refused", { dispatcher_id: this.o.id, code: leased.code ?? null });
      return 0;
    }
    await Promise.all(leased.items.map((item) => {
      const entity = `${item.intent.target_system}:${item.intent.target_entity.type}:${item.intent.target_entity.id}`;
      const prior = this.busy.get(entity) ?? Promise.resolve();
      const next = prior.then(() => this.handle(item)).catch((error: unknown) => {
        this.o.log("error", "dispatch_error", { dispatcher_id: this.o.id, mutation_id: item.mutation_id, error: (error as Error).message.slice(0, 300) });
      });
      this.busy.set(entity, next);
      return next.finally(() => {
        if (this.busy.get(entity) === next) this.busy.delete(entity);
      });
    }));
    return leased.items.length;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let wait = 0;
      try {
        if ((await this.tick()) === 0) wait = this.o.idleMs ?? 2000;
      } catch (error) {
        const missing = (error as Error).name === "InterfaceUnavailableError";
        this.o.log("warn", missing ? "interface_missing" : "dispatcher_error", { dispatcher_id: this.o.id, error: (error as Error).message.slice(0, 300) });
        wait = missing ? this.o.missingMs ?? 300_000 : 10_000;
      }
      if (wait) await abortableSleep(wait, signal);
    }
  }
}
