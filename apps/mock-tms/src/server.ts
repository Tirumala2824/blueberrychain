/**
 * Mock TMS / carrier platform and EDI gateway: contracts/apis/mock-tms.openapi.yaml.
 *
 * Connector-facing: shipments by updated_since, events by recorded_at cursor, claim
 * responses. Dispatcher-facing: re-route (ETag compare-and-set; 409 once the junction
 * is passed), evidence requests, claims and claim messages, EDI 865 - every write keyed
 * by Idempotency-Key (a repeat returns the original result) and findable by reference.
 * Simulator-facing: /__sim/* (not part of the contract).
 */

import { createHmac, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

type Json = Record<string, unknown>;
const STATUSES = ["PLANNED", "LOADING", "IN_TRANSIT", "AT_DOCK", "DELIVERED", "REJECTED", "CANCELLED"];
const KEY = /^[0-9a-f]{64}$/;

export interface MockTmsOptions {
  token?: string;
  logger?: boolean;
  fetch?: typeof fetch;
}

class Problem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
  }
}

function problem(reply: FastifyReply, p: Problem) {
  return reply
    .code(p.status)
    .type("application/problem+json")
    .send({ type: `https://blueberrychain.dev/problems/${p.status}`, title: p.title, status: p.status, ...(p.detail ? { detail: p.detail } : {}) });
}

export class TmsState {
  shipments = new Map<string, Json & { rev: number }>();
  events: Json[] = [];
  reroutes: Json[] = [];
  evidence: Json[] = [];
  claims = new Map<string, Json>();
  responses: Json[] = [];
  edi: Json[] = [];
  webhooks: Array<{ webhook_id: string; url: string; events: string[]; secret?: string }> = [];
  replies = new Map<string, { status: number; body: Json }>();
  private simNow: number | null = null;
  private last = 0;

  now(): number {
    return this.simNow ?? Date.now();
  }

  setClock(ms: number) {
    this.simNow = ms;
  }

  /** Strictly increasing recording times, so cursors never skip a record. */
  stamp(): string {
    this.last = Math.max(this.now(), this.last + 1);
    return new Date(this.last).toISOString();
  }

  reset() {
    Object.assign(this, new TmsState());
  }
}

export function buildMockTms(options: MockTmsOptions = {}): { app: FastifyInstance; state: TmsState } {
  const state = new TmsState();
  const app = Fastify({ logger: options.logger ?? false });
  const bearer = `Bearer ${options.token ?? "mock-tms-token"}`;
  const post = options.fetch ?? fetch;

  app.addHook("onRequest", async (req, reply) => {
    reply.header("Date", new Date(state.now()).toUTCString());
    if (req.headers.authorization !== bearer) return problem(reply, new Problem(401, "Unauthorized"));
  });
  app.setErrorHandler((error, _req, reply) =>
    error instanceof Problem ? problem(reply, error) : problem(reply, new Problem(500, "Internal error", error instanceof Error ? error.message : String(error))),
  );

  const etag = (s: Json & { rev: number }) => `"${s.rev}"`;
  const publicShipment = (s: Json & { rev: number }) => {
    const { rev: _rev, ...rest } = s;
    return rest;
  };

  /** Replay the stored answer for a repeated Idempotency-Key, or run and remember it. */
  async function idempotent(req: FastifyRequest, reply: FastifyReply, run: () => { status: number; body: Json }) {
    const key = String(req.headers["idempotency-key"] ?? "");
    if (!KEY.test(key)) throw new Problem(400, "Idempotency-Key required", "a sha256 hex mutation key");
    const scope = `${req.method} ${req.url.split("?")[0]} ${key}`;
    const previous = state.replies.get(scope);
    if (previous) return reply.code(previous.status).header("Idempotent-Replayed", "true").send(previous.body);
    const result = run();
    state.replies.set(scope, result);
    return reply.code(result.status).send(result.body);
  }

  function page<T>(rows: T[], req: FastifyRequest, size = 200) {
    const q = req.query as { page_token?: string; page_size?: string };
    const start = Number(q.page_token ?? 0);
    const n = Math.min(Number(q.page_size ?? size), 500);
    const data = rows.slice(start, start + n);
    return { data, next_page_token: start + n < rows.length ? String(start + n) : null };
  }

  function deliver(event: string, payload: Json) {
    for (const hook of state.webhooks.filter((w) => w.events.includes(event))) {
      const body = JSON.stringify({ event, data: payload });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (hook.secret) headers["X-Signature"] = createHmac("sha256", hook.secret).update(body).digest("hex");
      void post(hook.url, { method: "POST", headers, body }).catch(() => undefined);
    }
  }

  function shipmentOr404(id: string) {
    const s = state.shipments.get(id);
    if (!s) throw new Problem(404, "Shipment not found", id);
    return s;
  }

  // ---------------------------------------------------------------- reads
  app.get("/v1/shipments", async (req) => {
    const since = (req.query as { updated_since?: string }).updated_since;
    const rows = [...state.shipments.values()]
      .filter((s) => !since || String(s.updated_at) > new Date(since).toISOString())
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
      .map(publicShipment);
    return page(rows, req);
  });
  app.get("/v1/shipments/:id", async (req, reply) => {
    const s = shipmentOr404((req.params as { id: string }).id);
    reply.header("ETag", etag(s));
    return publicShipment(s);
  });
  app.get("/v1/shipments/:id/events", async (req) => {
    const { id } = req.params as { id: string };
    shipmentOr404(id);
    const since = (req.query as { since?: string }).since;
    return { data: state.events.filter((e) => e.shipment_id === id && (!since || String(e.recorded_at) > new Date(since).toISOString())) };
  });
  app.get("/v1/events", async (req) => {
    const since = (req.query as { since?: string }).since;
    if (!since) throw new Problem(400, "since is required");
    const cutoff = new Date(since).toISOString();
    return page(state.events.filter((e) => String(e.recorded_at) > cutoff), req, 500);
  });
  app.get("/v1/claim-responses", async (req) => {
    const since = (req.query as { since?: string }).since;
    if (!since) throw new Problem(400, "since is required");
    const cutoff = new Date(since).toISOString();
    return { data: state.responses.filter((r) => String(r.recorded_at) > cutoff) };
  });
  // Rows are read through a getter: reset() replaces the collections.
  const byReference = (rows: () => Json[]) => async (req: FastifyRequest) => {
    const ref = (req.query as { reference?: string }).reference;
    if (!ref) throw new Problem(400, "reference is required");
    return { data: rows().filter((r) => r.reference === ref) };
  };
  app.get("/v1/reroutes", byReference(() => state.reroutes));
  app.get("/v1/evidence-requests", byReference(() => state.evidence));
  app.get("/edi/v1/messages", byReference(() => state.edi));
  app.get("/v1/claims", byReference(() => [...state.claims.values()]));
  app.get("/v1/claims/:id", async (req) => {
    const claim = state.claims.get((req.params as { id: string }).id);
    if (!claim) throw new Problem(404, "Claim not found");
    return claim;
  });

  // ---------------------------------------------------------------- dispatcher writes
  app.post("/v1/shipments/:id/reroute", async (req, reply) =>
    idempotent(req, reply, () => {
      const id = (req.params as { id: string }).id;
      const s = shipmentOr404(id);
      const body = (req.body ?? {}) as Json;
      for (const f of ["new_destination_site_id", "reason", "reference"]) {
        if (!body[f]) throw new Problem(400, `${f} is required`);
      }
      if (req.headers["if-match"] !== etag(s)) throw new Problem(412, "Shipment changed", `current ETag ${etag(s)}`);
      if (s.status !== "IN_TRANSIT") throw new Problem(409, "Shipment is not in transit", String(s.status));
      if (s.junction_passed) throw new Problem(409, "Re-route window closed", `junction ${String(s.next_junction_site_id)} already passed`);
      const reroute: Json = {
        reroute_id: `RR-${randomUUID().slice(0, 8)}`,
        shipment_id: id,
        status: "ACCEPTED",
        previous_destination_site_id: s.destination_site_id,
        new_destination_site_id: body.new_destination_site_id,
        effective_at: new Date(state.now()).toISOString(),
        reference: body.reference,
      };
      state.reroutes.push(reroute);
      Object.assign(s, { destination_site_id: body.new_destination_site_id, updated_at: state.stamp(), rev: s.rev + 1 });
      deliver("shipment.status", publicShipment(s));
      return { status: 202, body: reroute };
    }),
  );

  app.post("/v1/evidence-requests", async (req, reply) =>
    idempotent(req, reply, () => {
      const body = (req.body ?? {}) as Json;
      shipmentOr404(String(body.shipment_id ?? ""));
      const request = { ...body, request_id: `ER-${randomUUID().slice(0, 8)}`, status: "OPEN", fulfilled_document_url: null };
      state.evidence.push(request);
      return { status: 201, body: request };
    }),
  );
  app.post("/v1/evidence-requests/:id/withdraw", async (req, reply) =>
    idempotent(req, reply, () => {
      const request = state.evidence.find((r) => r.request_id === (req.params as { id: string }).id);
      if (!request) throw new Problem(404, "Evidence request not found");
      request.status = "WITHDRAWN";
      return { status: 200, body: request };
    }),
  );

  app.post("/v1/claims", async (req, reply) =>
    idempotent(req, reply, () => {
      const body = (req.body ?? {}) as Json;
      shipmentOr404(String(body.shipment_id ?? ""));
      if (body.notice_only === false && (body.amount_usd === null || body.amount_usd === undefined)) {
        throw new Problem(422, "amount_usd is required for a filed claim");
      }
      const now = new Date(state.now()).toISOString();
      const existing = [...state.claims.values()].find((c) => c.shipment_id === body.shipment_id && c.status === "NOTICE_RECEIVED");
      // Filing after a notice upgrades the notice; otherwise a new claim is opened.
      const claim: Json = existing && body.notice_only === false
        ? Object.assign(existing, { status: "FILED", amount_usd: body.amount_usd, updated_at: now, reference: body.reference })
        : {
            claim_id: `CLM-${randomUUID().slice(0, 8)}`,
            shipment_id: body.shipment_id,
            status: body.notice_only ? "NOTICE_RECEIVED" : "FILED",
            amount_usd: body.amount_usd ?? null,
            offered_usd: null,
            paid_usd: null,
            reference: body.reference,
            created_at: now,
            updated_at: now,
          };
      state.claims.set(String(claim.claim_id), claim);
      return { status: 201, body: claim };
    }),
  );
  app.post("/v1/claims/:id/withdraw", async (req, reply) =>
    idempotent(req, reply, () => {
      const claim = state.claims.get((req.params as { id: string }).id);
      if (!claim) throw new Problem(404, "Claim not found");
      Object.assign(claim, { status: "WITHDRAWN", updated_at: new Date(state.now()).toISOString() });
      return { status: 200, body: claim };
    }),
  );
  app.post("/v1/claims/:id/messages", async (req, reply) =>
    idempotent(req, reply, () => {
      const claim = state.claims.get((req.params as { id: string }).id);
      if (!claim) throw new Problem(404, "Claim not found");
      const body = (req.body ?? {}) as Json;
      if (body.intent === "ACCEPT_OFFER") Object.assign(claim, { status: "SETTLED" });
      Object.assign(claim, { updated_at: new Date(state.now()).toISOString(), last_message: body });
      return { status: 202, body: claim };
    }),
  );

  app.post("/edi/v1/messages", async (req, reply) =>
    idempotent(req, reply, () => {
      const body = (req.body ?? {}) as Json;
      if (body.standard !== "X12" || body.transaction_set !== "865") throw new Problem(400, "Only X12 865 is supported");
      const message = { ...body, message_id: `EDI-${randomUUID().slice(0, 8)}`, status: "DELIVERED" };
      state.edi.push(message);
      return { status: 202, body: message };
    }),
  );

  app.post("/v1/webhooks", async (req, reply) => {
    const body = (req.body ?? {}) as { url?: string; events?: string[]; secret?: string };
    if (!body.url || !body.events?.length) throw new Problem(400, "url and events are required");
    const hook = { webhook_id: `WH-${randomUUID().slice(0, 8)}`, url: body.url, events: body.events, ...(body.secret ? { secret: body.secret } : {}) };
    state.webhooks.push(hook);
    return reply.code(201).send({ webhook_id: hook.webhook_id });
  });

  // ---------------------------------------------------------------- simulator entry points
  const records = (req: FastifyRequest) => (((req.body ?? {}) as { records?: Json[] }).records ?? []);
  app.put("/__sim/clock", async (req) => {
    const ms = Date.parse(String(((req.body ?? {}) as Json).now));
    if (Number.isNaN(ms)) throw new Problem(400, "now must be an ISO-8601 timestamp");
    state.setClock(ms);
    return { now: new Date(state.now()).toISOString() };
  });
  app.post("/__sim/reset", async () => {
    state.reset();
    return { reset: true };
  });
  app.post("/__sim/shipments", async (req) => {
    for (const r of records(req)) {
      const id = String(r.shipment_id ?? "");
      if (!id) throw new Problem(400, "shipment_id is required");
      const current = state.shipments.get(id);
      const merged = {
        status: "PLANNED",
        junction_passed: false,
        next_junction_site_id: null,
        eta_at: null,
        ...current,
        ...r,
        planned_destination_site_id: current?.planned_destination_site_id ?? r.destination_site_id,
        updated_at: state.stamp(),
        rev: (current?.rev ?? 0) + 1,
      } as Json & { rev: number };
      if (!STATUSES.includes(String(merged.status))) throw new Problem(400, `unknown status ${String(merged.status)}`);
      state.shipments.set(id, merged);
      deliver("shipment.status", publicShipment(merged));
    }
    return { upserted: records(req).length };
  });
  app.post("/__sim/events", async (req) => {
    let added = 0;
    for (const r of records(req)) {
      if (!r.event_id || !r.shipment_id || !r.kind || !r.at) throw new Problem(400, "event_id, shipment_id, kind and at are required");
      if (state.events.some((e) => e.event_id === r.event_id)) continue;
      const s = shipmentOr404(String(r.shipment_id));
      const event = { ...r, recorded_at: state.stamp() };
      state.events.push(event);
      added += 1;
      if (r.kind === "STATUS") {
        const changes: Json = {};
        for (const f of ["status", "eta_at", "next_junction_site_id", "junction_passed"]) if (f in r) changes[f] = r[f];
        Object.assign(s, changes, { updated_at: state.stamp(), rev: s.rev + 1 });
      }
      deliver(r.kind === "CUSTODY" ? "custody.event" : "shipment.status", event);
    }
    return { added };
  });
  app.post("/__sim/claim-responses", async (req) => {
    for (const r of records(req)) {
      const response = { response_id: `RSP-${randomUUID().slice(0, 8)}`, ...r, recorded_at: state.stamp() };
      state.responses.push(response);
      deliver("claim.response", response);
    }
    return { added: records(req).length };
  });
  app.get("/__sim/state", async () => ({
    shipments: state.shipments.size,
    events: state.events.length,
    reroutes: state.reroutes.length,
    claims: state.claims.size,
    edi: state.edi.length,
  }));

  return { app, state };
}
