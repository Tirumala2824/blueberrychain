/**
 * The dispatcher (ADR-0004): carry out mutations Snowflake's gateway already authorized,
 * and tell Snowflake exactly what the target showed. For each leased mutation:
 *
 * 1. a retry first asks the target what happened to the key (never resend blind);
 * 2. read the target, and stop without writing if it no longer matches expected_before;
 * 3. execute with the idempotency key; on a timeout or network error, ask for status
 *    instead of resending, and keep the mutation (no ACK) while the outcome is unknown;
 * 4. read the target again.
 *
 * API.ACK_MUTATION(mutation_id, attempt, ack) receives only observations
 * (contracts/schemas/api/mutation_ack.json); Snowflake decides VERIFIED, FAILED or
 * ABORTED_PRECONDITION from them and advances the plan. Writes to the same target entity
 * are serialized.
 */

import { isRefusal, refusalText, type EnginePort, type MutationAck, type NextActionsResult } from "@blueberrychain/bbc-api";
import { TargetRejectedError, type ActionHandler } from "@blueberrychain/connector-sdk";
import type { Logger } from "./log.js";
import { abortableSleep } from "./worker.js";

export type Leased = Extract<NextActionsResult, { actions: unknown }>["actions"][number];
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
  leaseS?: number;
  executeTimeoutMs?: number;
  idleMs?: number;
  missingMs?: number;
  now?: () => Date;
}

/** `ack` = the observations to send; null = the outcome is unknown, so nothing is sent yet. */
export interface Dispatched {
  ack: MutationAck | null;
  /** Why (for the log): the step that decided, and the target's code if it refused. */
  note: string;
}

const timeoutAfter = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`target did not answer within ${ms} ms`)), ms))]);

const ackCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^_+/, "") || "TARGET";

export class Dispatcher {
  private readonly busy = new Map<string, Promise<void>>();
  /** Leased mutations whose outcome is unknown; asked again (status first) on every tick. */
  private readonly unsettled = new Map<string, { item: Leased; since: number; checks: number }>();

  constructor(private readonly o: DispatcherOptions) {}

  private now(): string {
    return (this.o.now?.() ?? new Date()).toISOString();
  }

  pending(): string[] {
    return [...this.unsettled.keys()];
  }

  /** Carry out one leased mutation and collect what the target showed. `retry` = ask the target first. */
  async dispatchOne(item: Leased, retry = item.attempt > 1): Promise<Dispatched> {
    const intent = item.intent;
    const key = intent.idempotency_key;
    const ack = (a: Partial<MutationAck>): MutationAck => ({
      observed_before: null, observed_after: null, error: null, external_ref: null, dispatched_at: null, target_reported_at: null, ...a,
    });
    const handler = this.o.registry.find(intent) as ActionHandler<Intent> | undefined;
    if (!handler) {
      return { note: "no_handler", ack: ack({ error: { code: "NO_HANDLER", message: `no handler for ${intent.action_type} in ${intent.target_system}` } }) };
    }
    const readBack = async (externalRef: string, before: Record<string, unknown> | null, dispatchedAt: string | null, note: string): Promise<Dispatched> => {
      const after = await handler.readAfter(intent, externalRef);
      return { note, ack: ack({ observed_before: before, observed_after: after, external_ref: externalRef, dispatched_at: dispatchedAt, target_reported_at: this.now() }) };
    };
    try {
      if (retry) {
        const st = await handler.status(intent, key);
        if (st.state === "APPLIED" && st.externalRef) return await readBack(st.externalRef, null, null, "already_applied");
        if (st.state === "FAILED") {
          return { note: "target_failed", ack: ack({ external_ref: st.externalRef ?? null, error: { code: "TARGET_FAILED", message: "the target reports this key as failed" }, target_reported_at: this.now() }) };
        }
      }
      const before = await handler.readBefore(intent);
      const drift = firstMismatch(intent.expected_before as Record<string, unknown>, before);
      if (drift) {
        return {
          note: "precondition",
          ack: ack({ observed_before: before, error: { code: "PRECONDITION", message: `${drift.path.slice(1)}: expected ${JSON.stringify(drift.expected)}, observed ${JSON.stringify(drift.observed)}` } }),
        };
      }
      const dispatchedAt = this.now();
      let executed: { externalRef: string; response: unknown };
      try {
        executed = await timeoutAfter(handler.execute(intent, key), this.o.executeTimeoutMs ?? 30_000);
      } catch (error) {
        if (error instanceof TargetRejectedError) {
          // The HTTP status is the code Snowflake reads (409 / 412 = the target's state moved on).
          return {
            note: `rejected:${error.code}`,
            ack: ack({ observed_before: before, dispatched_at: dispatchedAt, target_reported_at: this.now(),
              error: { code: error.status ? String(error.status) : ackCode(error.code), message: `${error.code}: ${error.message}`.slice(0, 1000) } }),
          };
        }
        // Outcome unknown: ask, never resend in the same attempt.
        const st = await handler.status(intent, key).catch(() => ({ state: "UNKNOWN" as const, externalRef: undefined }));
        if (st.state === "APPLIED" && st.externalRef) return await readBack(st.externalRef, before, dispatchedAt, "applied_after_timeout");
        return { note: `unknown:${(error as Error).message.slice(0, 120)}`, ack: null };
      }
      return await readBack(executed.externalRef, before, dispatchedAt, "executed");
    } catch (error) {
      // Refused before any write (an intent the handler can't map, a 4xx on the read): report it.
      if (error instanceof TargetRejectedError) {
        return { note: `refused:${error.code}`, ack: ack({ error: { code: error.status ? String(error.status) : ackCode(error.code), message: `${error.code}: ${error.message}`.slice(0, 1000) } }) };
      }
      // The target couldn't be read or asked; nothing new was written in this step.
      return { note: `unreachable:${(error as Error).message.slice(0, 120)}`, ack: null };
    }
  }

  private async handle(item: Leased, retry: boolean): Promise<void> {
    const t0 = Date.now();
    const { ack, note } = await this.dispatchOne(item, retry || item.attempt > 1);
    const ctx = {
      dispatcher_id: this.o.id, mutation_id: item.mutation_id, action_type: item.intent.action_type, target_system: item.intent.target_system,
      attempt: item.attempt, note,
    };
    if (!ack) {
      const prior = this.unsettled.get(item.mutation_id);
      this.unsettled.set(item.mutation_id, { item, since: prior?.since ?? t0, checks: (prior?.checks ?? 0) + 1 });
      this.o.log("warn", "mutation_outcome_unknown", { ...ctx, checks: (prior?.checks ?? 0) + 1, since_ms: t0 - (prior?.since ?? t0) });
      return;
    }
    this.unsettled.delete(item.mutation_id);
    const res = await this.o.port.ackMutation(item.mutation_id, item.attempt, ack);
    const status = isRefusal(res) ? null : res.mutation_status;
    this.o.log(status === "VERIFIED" ? "info" : "warn", "mutation_acked", {
      ...ctx, external_ref: ack.external_ref, error: ack.error?.code ?? null, duration_ms: Date.now() - t0,
      mutation_status: status, plan: isRefusal(res) ? null : res.plan ?? null, refused: isRefusal(res) ? refusalText(res) : null,
    });
  }

  private schedule(item: Leased, retry: boolean): Promise<void> {
    const entity = `${item.intent.target_system}:${item.intent.target_entity.type}:${item.intent.target_entity.id}`;
    const prior = this.busy.get(entity) ?? Promise.resolve();
    const next = prior.then(() => this.handle(item, retry)).catch((error: unknown) => {
      this.o.log("error", "dispatch_error", { dispatcher_id: this.o.id, mutation_id: item.mutation_id, error: (error as Error).message.slice(0, 300) });
    });
    this.busy.set(entity, next);
    return next.finally(() => {
      if (this.busy.get(entity) === next) this.busy.delete(entity);
    });
  }

  /**
   * Settle what's still unknown (asking the target first), then lease a batch and dispatch it:
   * in parallel across targets, one at a time per target entity.
   */
  async tick(): Promise<number> {
    const retries = [...this.unsettled.values()].map((u) => this.schedule(u.item, true));
    const leased = await this.o.port.nextActions(this.o.id, this.o.batch ?? 10, this.o.leaseS ?? 300);
    if (isRefusal(leased)) {
      this.o.log("warn", "next_actions_refused", { dispatcher_id: this.o.id, error: refusalText(leased) });
      await Promise.all(retries);
      return retries.length;
    }
    if (leased.status === "STOPPED") this.o.log("info", "dispatch_stopped", { dispatcher_id: this.o.id });
    await Promise.all([...retries, ...leased.actions.map((item) => this.schedule(item, false))]);
    return retries.length + leased.actions.length;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let wait = 0;
      try {
        const n = await this.tick();
        if (n === 0) wait = this.o.idleMs ?? 2000;
        else if (this.unsettled.size) wait = Math.min(30_000, this.o.idleMs ?? 2000);
      } catch (error) {
        const missing = (error as Error).name === "InterfaceUnavailableError";
        this.o.log("warn", missing ? "interface_missing" : "dispatcher_error", { dispatcher_id: this.o.id, error: (error as Error).message.slice(0, 300) });
        wait = missing ? this.o.missingMs ?? 300_000 : 10_000;
      }
      if (wait) await abortableSleep(wait, signal);
    }
  }
}
