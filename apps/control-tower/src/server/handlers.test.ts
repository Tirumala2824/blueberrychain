import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConsoleEntry } from "../console/artifacts";
import { loadConfig } from "./config";
import { createAppContext, type AppContext } from "./context";
import * as h from "./handlers";

const ORIGIN = "http://127.0.0.1:3000";
const SA = "CASE-00000017";

let now = Date.parse("2026-10-06T08:00:00Z");
let ctx: AppContext;

function request(method: string, path: string, opts: { cookie?: string; csrf?: string; body?: unknown; host?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: opts.host ?? "127.0.0.1:3000" };
  if (opts.origin !== null) headers["origin"] = opts.origin ?? ORIGIN;
  if (opts.cookie) headers["cookie"] = `bbc_sid=${opts.cookie}`;
  if (opts.csrf) headers["x-bbc-csrf"] = opts.csrf;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
}

async function signIn(persona: string) {
  const res = await h.postSession(ctx, request("POST", "/api/session", { body: { persona } }));
  expect(res.status).toBe(200);
  const cookie = /bbc_sid=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!;
  const body = (await res.json()) as { csrf: string; identity: { user: string } };
  return { cookie, csrf: body.csrf, user: body.identity.user };
}

async function consoleRun(who: { cookie: string; csrf: string }, input: string, caseId: string | null = SA): Promise<ConsoleEntry> {
  const res = await h.postConsole(ctx, request("POST", "/api/console", { ...who, body: { input, case_id: caseId } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { entry: ConsoleEntry }).entry;
}

async function confirm(who: { cookie: string; csrf: string }, token: string): Promise<ConsoleEntry> {
  const res = await h.postConfirm(ctx, request("POST", "/api/console/confirm", { ...who, body: { token } }));
  return ((await res.json()) as { entry: ConsoleEntry }).entry;
}

function seek(state: string) {
  const tape = ctx.world!.tapes.find((t) => t.tape === "S-A")!;
  ctx.world!.seek("S-A", tape.frames.findIndex((f) => f.cases[SA]!.view.case.state === state));
}

beforeEach(() => {
  now = Date.parse("2026-10-06T08:00:00Z");
  ctx = createAppContext(loadConfig({ BBC_API_MODE: "fixture", BBC_FIXTURE_TAPES: "S-A,S-B", BBC_CT_SESSION_SECRET: "test-secret" }), {}, () => now);
});
afterEach(() => ctx.world?.reset());

describe("sessions", () => {
  it("signs in as a recorded persona and returns the Snowflake identity, never a credential", async () => {
    const res = await h.postSession(ctx, request("POST", "/api/session", { body: { persona: "sales" } }));
    const text = await res.clone().text();
    expect(res.headers.get("set-cookie")).toMatch(/^bbc_sid=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
    expect(JSON.parse(text)).toMatchObject({ mode: "fixture", identity: { persona: "sales", user: "BBC_DEMO_SALES", role: "BBC_SALES_MGR" } });
    expect(text).not.toMatch(/PAT|token|snowflakecomputing/i);
  });

  it("ignores a tampered or forged cookie", async () => {
    const { cookie } = await signIn("sales");
    const forged = `${cookie.slice(0, -2)}xx`;
    const res = await h.getSession(ctx, request("GET", "/api/session", { cookie: forged }));
    expect(((await res.json()) as { identity: unknown }).identity).toBeNull();
    expect((await h.getInbox(ctx, request("GET", "/api/inbox", { cookie: forged }))).status).toBe(401);
  });

  it("expires idle sessions", async () => {
    const { cookie } = await signIn("sales");
    now += 61 * 60_000;
    expect((await h.getInbox(ctx, request("GET", "/api/inbox", { cookie }))).status).toBe(401);
  });

  it("refuses sign-in from another host unless an access code is configured, and checks the code", async () => {
    const remote = await h.postSession(ctx, request("POST", "/api/session", { host: "10.0.0.5:3000", origin: null, body: { persona: "sales" } }));
    expect(remote.status).toBe(403);
    ctx = createAppContext(loadConfig({ BBC_API_MODE: "fixture", BBC_FIXTURE_TAPES: "S-A", BBC_CT_ACCESS_CODE: "blue-2026" }), {}, () => now);
    const wrong = await h.postSession(ctx, request("POST", "/api/session", { host: "10.0.0.5:3000", origin: null, body: { persona: "sales", access_code: "nope" } }));
    expect(wrong.status).toBe(401);
    const right = await h.postSession(ctx, request("POST", "/api/session", { host: "10.0.0.5:3000", origin: null, body: { persona: "sales", access_code: "blue-2026" } }));
    expect(right.status).toBe(200);
  });
});

describe("reads", () => {
  it("serves the inbox in Snowflake's order and the case view with the persona's viewer", async () => {
    const who = await signIn("quality");
    const inbox = (await (await h.getInbox(ctx, request("GET", "/api/inbox", who))).json()) as { rows: { case_id: string; inbox_rank: number }[] };
    expect(inbox.rows.map((r) => r.inbox_rank)).toEqual([...inbox.rows.map((r) => r.inbox_rank)].sort((a, b) => a - b));
    const res = await h.getCase(ctx, request("GET", `/api/cases/${SA}`, who), SA);
    const { view } = (await res.json()) as { view: { viewer: { user: string } } };
    expect(view.viewer.user).toBe("BBC_DEMO_QUALITY");
    expect((await h.getCase(ctx, request("GET", "/api/cases/CASE-00000999", who), "CASE-00000999")).status).toBe(404);
  });

  it("shows the policy only to the governance admin, as Snowflake's grants do", async () => {
    const admin = await signIn("govadmin");
    expect((await h.getPolicy(ctx, request("GET", "/api/policy", admin))).status).toBe(200);
    const sales = await signIn("sales");
    const res = await h.getPolicy(ctx, request("GET", "/api/policy", sales));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "interface_unavailable", interface: "ACTIVE_POLICY" });
  });
});

describe("console: governed writes", () => {
  it("turns `approve` into a confirm card with the exact CALL, then runs it once", async () => {
    seek("PENDING_APPROVAL");
    const sales = await signIn("sales");
    const entry = await consoleRun(sales, "approve");
    expect(entry.artifact.type).toBe("confirm");
    if (entry.artifact.type !== "confirm") return;
    const card = entry.artifact.card;
    expect(card).toMatchObject({
      procedure: "DECIDE_APPROVAL",
      statement: "CALL BBC_OS.API.DECIDE_APPROVAL(?, ?, ?, ?)",
      binds: [
        { name: "approval_id", value: "APR-00000060" },
        { name: "verdict", value: "APPROVE" },
        { name: "chosen_option_id", value: null },
        { name: "reason", value: null },
      ],
      user: "BBC_DEMO_SALES",
      role: "BBC_SALES_MGR",
      fixture: true,
    });
    expect(card.brief_hash).toMatch(/^[0-9a-f]{64}$/);
    const receipt = await confirm(sales, card.token);
    expect(receipt.artifact).toMatchObject({ type: "receipt", call: "DECIDE_APPROVAL" });
    const again = await confirm(sales, card.token);
    expect(again.artifact).toMatchObject({ type: "error", message: expect.stringMatching(/already used/) });
  });

  it("never lets another session use a confirmation, and expires it", async () => {
    seek("PENDING_APPROVAL");
    const sales = await signIn("sales");
    const other = await signIn("sales");
    const entry = await consoleRun(sales, "approve");
    const token = entry.artifact.type === "confirm" ? entry.artifact.card.token : "";
    expect((await confirm(other, token)).artifact).toMatchObject({ type: "error", message: expect.stringMatching(/another session/) });
    now += 91_000;
    expect((await confirm(sales, token)).artifact).toMatchObject({ type: "error", message: expect.stringMatching(/expired/) });
  });

  it("refuses to run a decision if the case changed after the person reviewed it", async () => {
    seek("PENDING_APPROVAL");
    const sales = await signIn("sales");
    const quality = await signIn("quality");
    const salesCard = await consoleRun(sales, "approve");
    const qualityCard = await consoleRun(quality, "approve APR-00000061");
    if (qualityCard.artifact.type !== "confirm" || salesCard.artifact.type !== "confirm") throw new Error("expected confirm cards");
    expect((await confirm(quality, qualityCard.artifact.card.token)).artifact.type).toBe("receipt");
    const stale = await confirm(sales, salesCard.artifact.card.token);
    expect(stale.artifact).toMatchObject({ type: "error", code: "CHANGED_SINCE_REVIEW" });
  });

  it("shows Snowflake's reason when the person can't decide", async () => {
    seek("PENDING_APPROVAL");
    const finance = await signIn("finance");
    expect((await consoleRun(finance, "approve")).artifact).toMatchObject({ type: "error", message: "This approval requires BBC_SALES_MGR" });
    const sales = await signIn("sales");
    expect((await consoleRun(sales, "reject")).artifact).toMatchObject({ type: "error", message: expect.stringMatching(/reason is required/) });
    expect((await consoleRun(sales, "choose OPT-00000105 reason \"faster\"")).artifact).toMatchObject({ type: "error", message: expect.stringMatching(/lets you choose/) });
  });

  it("requires the CSRF token and an allowed origin for every write", async () => {
    const sales = await signIn("sales");
    const noToken = await h.postConsole(ctx, request("POST", "/api/console", { cookie: sales.cookie, body: { input: "status", case_id: SA } }));
    expect(noToken.status).toBe(403);
    const badOrigin = await h.postConsole(ctx, request("POST", "/api/console", { ...sales, origin: "https://evil.example", body: { input: "status", case_id: SA } }));
    expect(badOrigin.status).toBe(403);
  });
});

describe("console: reads, proof and Analyst", () => {
  it("answers read commands from the case view", async () => {
    seek("PENDING_APPROVAL");
    const sales = await signIn("sales");
    const status = await consoleRun(sales, "status");
    expect(status.artifact).toMatchObject({ type: "status", state: "PENDING_APPROVAL", stage: "Approval", awaiting_roles: ["BBC_SALES_MGR", "BBC_QUALITY_MGR"] });
    expect((await consoleRun(sales, "why 105")).artifact).toMatchObject({ type: "option", eliminated: [{ code: "SPEC_INFEASIBLE" }] });
    expect((await consoleRun(sales, "aprove")).artifact).toMatchObject({ type: "error", suggestions: ["approve"] });
    const history = await h.getHistory(ctx, request("GET", `/api/console/history?case=${SA}`, sales));
    expect(((await history.json()) as { entries: unknown[] }).entries).toHaveLength(3);
  });

  it("runs proof only where Snowflake offers it, and shows a tampered clone's first bad entry", async () => {
    seek("OUTCOME_RECORDED");
    const auditor = await signIn("auditor");
    expect((await consoleRun(auditor, "verify")).artifact).toMatchObject({ type: "proof", call: "VERIFY_LEDGER", result: { ok: true } });
    const tamper = await consoleRun(auditor, "verify --table BBC_OS.SANDBOX.LEDGER_TAMPER");
    expect(tamper.artifact).toMatchObject({ type: "proof", result: { ok: false, first_bad_seq: 416, reason: "PAYLOAD_HASH_MISMATCH" } });
    expect((await consoleRun(auditor, "replay")).artifact).toMatchObject({ type: "proof", call: "REPLAY_EVIDENCE", result: { equal: true } });
    const sales = await signIn("sales");
    expect((await consoleRun(sales, "verify")).artifact).toMatchObject({ type: "error", message: expect.stringMatching(/no way to verify/) });
  });

  it("answers recorded Analyst questions and lists them otherwise", async () => {
    const quality = await signIn("quality");
    expect((await consoleRun(quality, "? which lots have less than 10 days of shelf life left", null)).artifact).toMatchObject({ type: "analyst", recorded: true });
    expect((await consoleRun(quality, "ask how many trucks are late", null)).artifact).toMatchObject({ type: "analyst_miss" });
  });
});
