/**
 * The control tower's HTTP API, framework-free (Web Request -> Response) so it is unit
 * tested directly; src/app/api/** only forwards to these functions.
 *
 * The browser never receives a Snowflake credential or host: every handler acts as the
 * signed-in person's own Snowflake identity, on the server, through @blueberrychain/bbc-api.
 */

import { timingSafeEqual } from "node:crypto";
import { formatSse, readSse, type Persona } from "@blueberrychain/bbc-api";
import type { FeedEvent } from "./changefeed";
import { confirmGrant, historyFor, portFor, runConsole } from "./console-service";
import type { AppContext } from "./context";
import { errorResponse, isLoopbackHost, json, problem, readBody, requireSession, requireWrite, sessionOf } from "./http";
import { isPersona } from "./identity";
import { clearCookieHeader, cookieHeader, isHttps } from "./session";

const CASE_ID = /^CASE-\d{8,12}$/;
const RUN_ID = /^RUN-\d{8,12}$/;

const sessionBody = (ctx: AppContext, s: ReturnType<typeof sessionOf>) => ({
  mode: ctx.config.mode,
  identity: s ? { persona: s.identity.persona, user: s.identity.user, role: s.identity.role } : null,
  csrf: s?.csrf ?? null,
  options: ctx.provider.options(),
  access_code_required: Boolean(ctx.config.accessCode),
});

// ---- session ------------------------------------------------------------------------------

export async function getSession(ctx: AppContext, req: Request): Promise<Response> {
  return json(ctx, 200, sessionBody(ctx, sessionOf(ctx, req)));
}

export async function postSession(ctx: AppContext, req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && !ctx.config.allowedOrigins.includes(origin)) return problem(ctx, 403, "origin", `Sign-in from ${origin} is not accepted.`);
  const body = await readBody(req);
  if (ctx.config.accessCode) {
    const given = Buffer.from(String(body["access_code"] ?? ""));
    const expected = Buffer.from(ctx.config.accessCode);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return problem(ctx, 401, "access_code", "The access code is wrong.");
  } else if (!isLoopbackHost(req.headers.get("host"))) {
    return problem(ctx, 403, "loopback_only", "Without BBC_CT_ACCESS_CODE the control tower only accepts sign-in on this machine (127.0.0.1).");
  }
  const persona = body["persona"];
  if (!isPersona(persona)) return problem(ctx, 400, "persona", "Choose one of the listed people to sign in as.");
  try {
    const identity = await ctx.provider.signIn(persona);
    const old = sessionOf(ctx, req);
    if (old) ctx.store.destroy(old.id);
    const { session, cookie } = ctx.store.create(identity);
    return json(ctx, 200, sessionBody(ctx, session), { "set-cookie": cookieHeader(cookie, ctx.config.sessionMaxH * 3600, isHttps(req)) });
  } catch (error) {
    return errorResponse(ctx, error);
  }
}

export async function deleteSession(ctx: AppContext, req: Request): Promise<Response> {
  const s = sessionOf(ctx, req);
  if (s) ctx.store.destroy(s.id);
  return json(ctx, 200, sessionBody(ctx, null), { "set-cookie": clearCookieHeader(isHttps(req)) });
}

// ---- reads ----------------------------------------------------------------------------------

export async function getInbox(ctx: AppContext, req: Request): Promise<Response> {
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  try {
    const rows = await portFor(ctx, g.session).inbox();
    rows.sort((a, b) => a.inbox_rank - b.inbox_rank);
    return json(ctx, 200, { rows, fetched_at: new Date(ctx.now()).toISOString() });
  } catch (error) {
    return errorResponse(ctx, error);
  }
}

export async function getCase(ctx: AppContext, req: Request, caseId: string): Promise<Response> {
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  if (!CASE_ID.test(caseId)) return problem(ctx, 400, "case_id", `${caseId} is not a case id.`);
  try {
    const view = await portFor(ctx, g.session).caseView(caseId);
    return json(ctx, 200, { view, fetched_at: new Date(ctx.now()).toISOString() });
  } catch (error) {
    return errorResponse(ctx, error);
  }
}

export async function getPolicy(ctx: AppContext, req: Request): Promise<Response> {
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  try {
    return json(ctx, 200, { policy: await portFor(ctx, g.session).activePolicy() });
  } catch (error) {
    return errorResponse(ctx, error);
  }
}

export async function getHealth(ctx: AppContext): Promise<Response> {
  return json(ctx, 200, {
    ok: true,
    mode: ctx.config.mode,
    server_time: new Date(ctx.now()).toISOString(),
    tapes: ctx.world?.status() ?? [],
    pollers: ctx.feed.activePollers(),
    relay: Boolean(ctx.config.relayUrl),
  });
}

// ---- console ----------------------------------------------------------------------------------

export async function postConsole(ctx: AppContext, req: Request): Promise<Response> {
  const g = requireWrite(ctx, req);
  if ("response" in g) return g.response;
  const body = await readBody(req);
  const input = typeof body["input"] === "string" ? body["input"] : "";
  const caseId = typeof body["case_id"] === "string" && CASE_ID.test(body["case_id"]) ? body["case_id"] : null;
  return json(ctx, 200, { entry: await runConsole(ctx, g.session, input, caseId) });
}

export async function postConfirm(ctx: AppContext, req: Request): Promise<Response> {
  const g = requireWrite(ctx, req);
  if ("response" in g) return g.response;
  const body = await readBody(req);
  return json(ctx, 200, { entry: await confirmGrant(ctx, g.session, String(body["token"] ?? "")) });
}

export async function getHistory(ctx: AppContext, req: Request): Promise<Response> {
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  const caseId = new URL(req.url).searchParams.get("case");
  return json(ctx, 200, { entries: historyFor(g.session, caseId && CASE_ID.test(caseId) ? caseId : null) });
}

// ---- fixture controls -------------------------------------------------------------------------

export async function getFixture(ctx: AppContext, req: Request): Promise<Response> {
  if (!ctx.world) return problem(ctx, 404, "not_fixture", "The control tower is in live mode.");
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  return json(ctx, 200, { tapes: ctx.world.status() });
}

export async function postFixture(ctx: AppContext, req: Request): Promise<Response> {
  if (!ctx.world) return problem(ctx, 404, "not_fixture", "The control tower is in live mode.");
  const g = requireWrite(ctx, req);
  if ("response" in g) return g.response;
  const body = await readBody(req);
  try {
    const op = body["op"];
    if (op === "reset") ctx.world.reset();
    else if (op === "step") ctx.world.step(String(body["tape"]), Number(body["delta"] ?? 1));
    else if (op === "seek") ctx.world.seek(String(body["tape"]), Number(body["frame"]));
    else return problem(ctx, 400, "op", "op must be reset, step or seek.");
    return json(ctx, 200, { tapes: ctx.world.status() });
  } catch (error) {
    return problem(ctx, 400, "fixture", (error as Error).message);
  }
}

// ---- live streams -------------------------------------------------------------------------------

const SSE_HEADERS = (ctx: AppContext) => ({
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
  "x-bbc-mode": ctx.config.mode,
});

/** Inbox and case change notifications for the signed-in person (server-sent events). */
export function getStream(ctx: AppContext, req: Request): Response {
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  const session = g.session;
  const watch = new URL(req.url).searchParams.get("case");
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          cleanup();
        }
      };
      send(formatSse({ event: "ready", data: JSON.stringify({ mode: ctx.config.mode, poll_ms: ctx.config.pollMs }) }));
      const unsubscribe = ctx.feed.subscribe(session.identity.user, () => portFor(ctx, session), (event: FeedEvent) => {
        if (event.type === "case.changed" && watch && event.case_id !== watch) return;
        send(formatSse({ event: event.type, data: JSON.stringify(event) }));
      });
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), 15_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS(ctx) });
}

/**
 * A running agent's trace, live and unrecorded (the recorded trace arrives with the case
 * view when the run ends). The run must be on a case Snowflake lets this person see.
 */
export async function getTrace(ctx: AppContext, req: Request, runId: string): Promise<Response> {
  const g = requireSession(ctx, req);
  if ("response" in g) return g.response;
  const caseId = new URL(req.url).searchParams.get("case") ?? "";
  if (!RUN_ID.test(runId) || !CASE_ID.test(caseId)) return problem(ctx, 400, "ids", "A run id and its case id are required.");
  let view;
  try {
    view = await portFor(ctx, g.session).caseView(caseId);
  } catch (error) {
    return errorResponse(ctx, error);
  }
  if (!view.agents.runs.some((r) => r.run_id === runId)) return problem(ctx, 404, "run", `${runId} is not a run on ${caseId}.`);

  const enc = new TextEncoder();
  const world = ctx.world;
  const { relayUrl, relayToken } = ctx.config;
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(formatSse({ event, data: JSON.stringify(data) })));
      try {
        if (world) {
          for (const step of world.trace(runId) ?? []) {
            await new Promise((r) => setTimeout(r, Math.min(step.delay_ms, 5000)));
            if (abort.signal.aborted) return;
            send("agent.trace", step.event);
          }
          send("agent.end", { run_id: runId, recorded: true });
        } else if (relayUrl) {
          const upstream = await fetch(`${relayUrl.replace(/\/$/, "")}/v1/runs/${runId}/events`, {
            headers: { accept: "text/event-stream", ...(relayToken ? { authorization: `Bearer ${relayToken}` } : {}) },
            signal: abort.signal,
          });
          if (!upstream.ok || !upstream.body) {
            send("agent.unavailable", { message: `The engine's trace relay answered ${upstream.status}.` });
          } else {
            for await (const e of readSse(upstream.body)) send(e.event === "message" ? "agent.trace" : e.event, JSON.parse(e.data));
          }
        } else {
          send("agent.unavailable", { message: "Live traces need the engine's trace relay (set BBC_ENGINE_RELAY_URL). The recorded trace appears when the run ends." });
        }
      } catch (error) {
        if (!abort.signal.aborted) send("agent.unavailable", { message: (error as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          /* closed by the client */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS(ctx) });
}

export type { Persona };
