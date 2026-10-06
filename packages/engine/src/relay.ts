/**
 * Live agent traces for the control tower: the engine keeps each running agent's
 * normalized events in memory and serves them over loopback SSE. Live events are
 * unrecorded by definition; the recorded trace is the one END_AGENT_RUN stores.
 */

import { createServer, type Server } from "node:http";
import { formatSse } from "@blueberrychain/bbc-api";
import type { TraceEvent } from "./agents.js";

interface RunBuffer {
  events: TraceEvent[];
  ended: boolean;
  endedAt: number | null;
  listeners: Set<(e: TraceEvent | null) => void>;
}

const MAX_EVENTS = 2000;
const KEEP_MS = 10 * 60_000;

export class TraceHub {
  private readonly runs = new Map<string, RunBuffer>();

  constructor(private readonly now: () => number = Date.now) {}

  private buffer(runId: string): RunBuffer {
    let b = this.runs.get(runId);
    if (!b) {
      b = { events: [], ended: false, endedAt: null, listeners: new Set() };
      this.runs.set(runId, b);
    }
    return b;
  }

  publish(event: TraceEvent): void {
    const b = this.buffer(event.run_id);
    if (b.events.length < MAX_EVENTS) b.events.push(event);
    for (const l of b.listeners) l(event);
  }

  end(runId: string): void {
    const b = this.buffer(runId);
    b.ended = true;
    b.endedAt = this.now();
    for (const l of b.listeners) l(null);
    b.listeners.clear();
    this.gc();
  }

  /** Events after `afterSeq`, then live ones until the run ends; returns the unsubscribe function. */
  follow(runId: string, afterSeq: number, onEvent: (e: TraceEvent | null) => void): () => void {
    const b = this.runs.get(runId);
    if (!b) {
      onEvent(null);
      return () => {};
    }
    for (const e of b.events) if (e.seq > afterSeq) onEvent(e);
    if (b.ended) {
      onEvent(null);
      return () => {};
    }
    b.listeners.add(onEvent);
    return () => b.listeners.delete(onEvent);
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  active(): string[] {
    return [...this.runs.entries()].filter(([, b]) => !b.ended).map(([id]) => id);
  }

  private gc(): void {
    const t = this.now();
    for (const [id, b] of this.runs) if (b.ended && b.endedAt !== null && t - b.endedAt > KEEP_MS) this.runs.delete(id);
  }
}

/** GET /v1/runs/:id/events (SSE, Last-Event-ID resumes), GET /v1/runs, GET /healthz. Bearer token required. */
export function createRelayServer(hub: TraceHub, token: string): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, active: hub.active().length }));
      return;
    }
    if (!token || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (url.pathname === "/v1/runs") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ active: hub.active() }));
      return;
    }
    const m = /^\/v1\/runs\/(RUN-\d{8,12})\/events$/.exec(url.pathname);
    if (!m || req.method !== "GET") {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const runId = m[1]!;
    if (!hub.has(runId)) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "unknown_run" }));
      return;
    }
    const after = Number(req.headers["last-event-id"] ?? -1);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
    const unsubscribe = hub.follow(runId, Number.isFinite(after) ? after : -1, (e) => {
      if (e) res.write(formatSse({ event: "agent.trace", id: String(e.seq), data: JSON.stringify(e) }));
      else {
        res.write(formatSse({ event: "agent.end", data: JSON.stringify({ run_id: runId, recorded: false }) }));
        res.end();
      }
    });
    req.on("close", unsubscribe);
  });
}
