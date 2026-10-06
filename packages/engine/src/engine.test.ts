import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { InterfaceUnavailableError, type EnginePort, type NextActionsResult } from "@blueberrychain/bbc-api";
import { TmsClient, carrierHandlers } from "@blueberrychain/connector-carrier";
import { TargetRejectedError, type ActionHandler } from "@blueberrychain/connector-sdk";
import { buildMockTms } from "@blueberrychain/mock-tms";
import { contractsDir, validate } from "@blueberrychain/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CortexAgentProvider, type AgentProvider } from "./agents.js";
import { Dispatcher, HandlerRegistry, firstMismatch, type Leased } from "./dispatch.js";
import { silentLogger } from "./log.js";
import { TraceHub, createRelayServer } from "./relay.js";
import { Worker } from "./worker.js";

const fixture = <T>(name: string, i = 0) =>
  (JSON.parse(readFileSync(join(contractsDir(), "fixtures", "api", `${name}.json`), "utf-8")) as { valid: T[] }).valid[i]!;
const started = fixture<Extract<Awaited<ReturnType<EnginePort["startAgentRun"]>>, { status: "OK" }>>("start_agent_run_result");

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const STREAM = [
  'event: response.status\ndata: {"status":"planning","message":"Planning"}\n\n',
  'event: response.tool_use\ndata: {"tool_use_id":"tu_1","name":"GET_CASE_CONTEXT","input":{}}\n\n',
  'event: response.tool_result\ndata: {"tool_use_id":"tu_1","status":"success","content":[{"json":{"evidence_id":"EV:PACK:PACK-00000040#/lots/0"}}]}\n\n',
  "event: response.thinking.delta\ndata: {\"text\":\"Check the \"}\n\nevent: response.thinking.delta\ndata: {\"text\":\"probe.\"}\n\n",
  'event: response.text.delta\ndata: {"text":"Pre-cool "}\n\nevent: response.te',
  'xt.delta\ndata: {"text":"delay."}\n\n',
  'event: response\ndata: {"role":"assistant","usage":{"input_tokens":1200,"output_tokens":90}}\n\n',
];

describe("Cortex Agent provider", () => {
  it("streams a run as normalized events, merging deltas, and records it", async () => {
    const seen: string[] = [];
    let request: { url: string; init: RequestInit } | null = null;
    const provider = new CortexAgentProvider({
      account: "acct", token: "pat-agent",
      fetch: (async (url: string, init: RequestInit) => {
        request = { url, init };
        return sseResponse(STREAM);
      }) as unknown as typeof fetch,
    });
    const record = await provider.run({ ...started, expires_at: new Date(Date.now() + 60_000).toISOString() }, (e) => seen.push(e.kind));
    expect(request!.url).toBe("https://acct.snowflakecomputing.com/api/v2/databases/BBC_OS/schemas/AGENT/agents/EXCURSION_FORENSICS:run");
    expect((request!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer pat-agent");
    expect(JSON.parse(String(request!.init.body)).messages[0].content[0].text).toBe(started.message);
    expect(seen).toEqual(["STATUS", "TOOL_USE", "TOOL_RESULT", "THINKING", "TEXT", "DONE"]);
    expect(record).toMatchObject({ status: "COMPLETED", tokens: { input: 1200, output: 90 }, error: null });
    expect(record.trace[2]!.tool_result!.evidence_ids).toEqual(["EV:PACK:PACK-00000040#/lots/0"]);
    expect(record.trace[4]!.text).toBe("Pre-cool delay.");
    expect(validate("api/agent_run_record.json", record)).toEqual([]);
  });

  it("fails closed when the stream ends early or reports an error", async () => {
    const run = (chunks: string[]) =>
      new CortexAgentProvider({ account: "acct", token: "t", fetch: (async () => sseResponse(chunks)) as unknown as typeof fetch })
        .run({ ...started, expires_at: new Date(Date.now() + 60_000).toISOString() }, () => {});
    expect(await run(STREAM.slice(0, 3))).toMatchObject({ status: "FAILED", error: { code: "STREAM_ENDED" } });
    expect(await run(['event: error\ndata: {"code":"399504","message":"tool budget exhausted"}\n\n'])).toMatchObject({ status: "FAILED", error: { code: "399504" } });
  });

  it("expires a run that outlives its capability", async () => {
    const provider = new CortexAgentProvider({
      account: "acct", token: "t", timeoutMs: 1200,
      fetch: ((_: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch,
    });
    const record = await provider.run({ ...started, expires_at: new Date(Date.now() + 60_000).toISOString() }, () => {});
    expect(record).toMatchObject({ status: "EXPIRED", error: { code: "RUN_EXPIRED" } });
  });
});

function fakePort(overrides: Partial<EnginePort>): EnginePort {
  const no = () => Promise.reject(new Error("not scripted"));
  return { claimWork: no, advanceCase: no, executePlan: no, startAgentRun: no, endAgentRun: no, nextActions: no, ackMutation: no, ...overrides };
}

describe("lifecycle worker", () => {
  type Claimed = Awaited<ReturnType<EnginePort["claimWork"]>>;
  const claim = (i: number): Claimed => fixture<Claimed>("claim_work_result", i);

  it("does exactly the step Snowflake leased: advance with the expected state", async () => {
    const advanceCase = vi.fn(async () => fixture<Awaited<ReturnType<EnginePort["advanceCase"]>>>("advance_case_result"));
    const w = new Worker({ id: "w", port: fakePort({ claimWork: async () => claim(0), advanceCase }), provider: {} as AgentProvider, hub: new TraceHub(), log: silentLogger });
    expect(await w.step()).toBe("advanced");
    expect(advanceCase).toHaveBeenCalledWith("CASE-00000017", "OPEN");
  });

  it("treats a stale expected state as someone else's progress, not an error", async () => {
    const advanceCase = vi.fn(async () => fixture<Awaited<ReturnType<EnginePort["advanceCase"]>>>("advance_case_result", 2));
    const w = new Worker({ id: "w", port: fakePort({ claimWork: async () => claim(0), advanceCase }), provider: {} as AgentProvider, hub: new TraceHub(), log: silentLogger });
    expect(await w.step()).toBe("stale");
  });

  it("executes the approved plan when Snowflake hands it ENGINE work, and waits if the lease lacks the recommendation", async () => {
    const executePlan = vi.fn(async () => fixture<Awaited<ReturnType<EnginePort["executePlan"]>>>("execute_plan_result"));
    const port = fakePort({ claimWork: async () => claim(2), executePlan });
    const w = new Worker({ id: "w", port, provider: {} as AgentProvider, hub: new TraceHub(), log: silentLogger });
    expect(await w.step()).toBe("executed");
    expect(executePlan).toHaveBeenCalledWith("CASE-00000017", "REC-00000044");
    const { rec_id: _rec, ...withoutRec } = claim(2) as Extract<Claimed, { next: unknown }>;
    const gap = new Worker({ id: "w", port: fakePort({ claimWork: async () => withoutRec as Claimed, executePlan }), provider: {} as AgentProvider, hub: new TraceHub(), log: silentLogger });
    expect(await gap.step()).toBe("missing");
    expect(executePlan).toHaveBeenCalledTimes(1);
  });

  it("is idle when there is nothing to do", async () => {
    const w = new Worker({ id: "w", port: fakePort({ claimWork: async () => claim(3) }), provider: {} as AgentProvider, hub: new TraceHub(), log: silentLogger });
    expect(await w.step()).toBe("idle");
  });

  it("runs the agent Snowflake named, publishes its trace live, and ends the run", async () => {
    const hub = new TraceHub();
    const provider: AgentProvider = {
      name: "cortex-agent",
      run: async (s, onEvent) => {
        onEvent({ run_id: s.run_id, seq: 0, at: "2026-10-06T07:05:01Z", kind: "STATUS", text: "Planning" });
        return fixture("agent_run_record");
      },
    };
    const startAgentRun = vi.fn(async () => started);
    const endAgentRun = vi.fn(async () => fixture<Awaited<ReturnType<EnginePort["endAgentRun"]>>>("end_agent_run_result"));
    const agentWork = { ...claim(1), decision_point: "D1" } as Claimed;
    const w = new Worker({ id: "w", port: fakePort({ claimWork: async () => agentWork, startAgentRun, endAgentRun }), provider, hub, log: silentLogger });
    expect(await w.step()).toBe("agent");
    expect(startAgentRun).toHaveBeenCalledWith({ case_id: "CASE-00000023", agent: "EXCURSION_FORENSICS", decision_point: "D1", provider: "cortex-agent", model: null });
    expect(endAgentRun).toHaveBeenCalledWith("RUN-00000210", expect.objectContaining({ status: "COMPLETED" }));
    const events: unknown[] = [];
    hub.follow("RUN-00000210", -1, (e) => events.push(e));
    expect(events).toHaveLength(2); // the live event, then end-of-run
  });

  it("backs off, instead of crash-looping, while an interface isn't delivered", async () => {
    const w = new Worker({ id: "w", port: fakePort({ claimWork: () => Promise.reject(new InterfaceUnavailableError("CLAIM_WORK")) }), provider: {} as AgentProvider, hub: new TraceHub(), log: silentLogger });
    expect(await w.step()).toBe("missing");
  });
});

const leased = (over: Partial<Leased> = {}): Leased => ({ ...fixture<Extract<NextActionsResult, { actions: unknown }>>("next_actions_result").actions[0]!, ...over });
const KEY = leased().intent.idempotency_key;

function fakeHandler(over: Partial<ActionHandler<never>> = {}): ActionHandler<never> & { calls: string[] } {
  const calls: string[] = [];
  const h = {
    actionTypes: ["REROUTE"], targetSystem: "TMS", calls,
    readBefore: async () => (calls.push("readBefore"), { status: "IN_TRANSIT", destination_site_id: "SITE-SUMMIT-SLC" }),
    execute: async () => (calls.push("execute"), { externalRef: "RR-1", response: { ok: true } }),
    status: async () => (calls.push("status"), { state: "UNKNOWN" as const }),
    readAfter: async () => (calls.push("readAfter"), { status: "IN_TRANSIT", destination_site_id: "SITE-BAYLINE-SAC" }),
    ...over,
  };
  return h;
}
const dispatcher = (h: ActionHandler<never>, port: Partial<EnginePort> = {}) =>
  new Dispatcher({ id: "engine-1/dispatcher", port: fakePort(port), registry: new HandlerRegistry([h]), log: silentLogger, executeTimeoutMs: 200 });
const okAck = (id: string) => ({ status: "OK" as const, mutation_id: id, mutation_status: "VERIFIED" as const, errors: [], ledger_seq: 1, plan: "EXECUTING" as const });

describe("dispatcher", () => {
  it("compares only what the target reports", () => {
    expect(firstMismatch({ a: 1, b: "x" }, { a: 1, b: "x", c: 2 })).toBeNull();
    expect(firstMismatch({ a: 1 }, { a: 2 })).toEqual({ path: "/a", expected: 1, observed: 2 });
    expect(firstMismatch({ unobservable: true }, {})).toBeNull();
  });

  it("reports what it observed before and after the write, never an outcome", async () => {
    const h = fakeHandler();
    const { ack } = await dispatcher(h).dispatchOne(leased());
    expect(ack).toMatchObject({ error: null, external_ref: "RR-1", observed_before: { destination_site_id: "SITE-SUMMIT-SLC" }, observed_after: { destination_site_id: "SITE-BAYLINE-SAC" } });
    expect(h.calls).toEqual(["readBefore", "execute", "readAfter"]);
    expect(validate("api/mutation_ack.json", ack)).toEqual([]);
  });

  it("does not write when the target drifted from expected_before, and says so as PRECONDITION", async () => {
    const h = fakeHandler({ readBefore: async () => ({ status: "DELIVERED", destination_site_id: "SITE-SUMMIT-SLC" }) });
    const { ack } = await dispatcher(h).dispatchOne(leased());
    expect(ack).toMatchObject({ observed_before: { status: "DELIVERED" }, observed_after: null, error: { code: "PRECONDITION", message: expect.stringMatching(/^status: expected "IN_TRANSIT"/) } });
    expect(validate("api/mutation_ack.json", ack)).toEqual([]);
    expect((h as unknown as { calls: string[] }).calls).not.toContain("execute");
  });

  it("never resends after a timeout: it asks for the key's status and sends nothing while the outcome is unknown", async () => {
    const hang = fakeHandler({ execute: () => new Promise(() => {}) });
    expect(await dispatcher(hang).dispatchOne(leased())).toMatchObject({ ack: null });
    expect(hang.calls).toEqual(["readBefore", "status"]);
    const appliedAnyway = fakeHandler({ execute: () => Promise.reject(new Error("socket hang up")), status: async () => ({ state: "APPLIED" as const, externalRef: "RR-9" }) });
    expect((await dispatcher(appliedAnyway).dispatchOne(leased())).ack).toMatchObject({ external_ref: "RR-9", observed_after: { destination_site_id: "SITE-BAYLINE-SAC" } });
  });

  it("keeps an unknown outcome and settles it on the next tick, asking the target first", async () => {
    let targetKnowsKey = false;
    let writes = 0;
    const h = fakeHandler({
      execute: () => (writes += 1, new Promise(() => {})),
      status: async () => (targetKnowsKey ? { state: "APPLIED" as const, externalRef: "RR-5" } : { state: "UNKNOWN" as const }),
    });
    let leases = 0;
    const acks: { id: string; attempt: number; ack: unknown }[] = [];
    const d = dispatcher(h, {
      nextActions: async () => ({ status: "OK", actions: leases++ === 0 ? [leased()] : [] }),
      ackMutation: async (id, attempt, ack) => (acks.push({ id, attempt, ack }), okAck(id)),
    });
    expect(await d.tick()).toBe(1);
    expect(acks).toHaveLength(0);
    expect(d.pending()).toEqual(["MUT-00000301"]);
    targetKnowsKey = true;
    expect(await d.tick()).toBe(1);
    expect(acks).toEqual([{ id: "MUT-00000301", attempt: 1, ack: expect.objectContaining({ external_ref: "RR-5" }) }]);
    expect(d.pending()).toEqual([]);
    expect(writes).toBe(1);
    expect(h.calls).toEqual(["readBefore", "readAfter"]);
  });

  it("on a retried lease, asks first and skips the write if it already applied", async () => {
    const h = fakeHandler({ status: async () => ({ state: "APPLIED" as const, externalRef: "RR-7" }) });
    const { ack } = await dispatcher(h).dispatchOne(leased({ attempt: 2 }));
    expect(ack).toMatchObject({ external_ref: "RR-7", observed_before: null });
    expect(h.calls).toEqual(["readAfter"]);
  });

  it("passes a definitive refusal on with the target's HTTP status as the code, and a missing handler as NO_HANDLER", async () => {
    const h = fakeHandler({ execute: () => Promise.reject(new TargetRejectedError(409, "TMS_409", "Re-route window closed")) });
    expect((await dispatcher(h).dispatchOne(leased())).ack).toMatchObject({ error: { code: "409", message: "TMS_409: Re-route window closed" } });
    const sap = leased({ intent: { ...leased().intent, action_type: "SO_CREATE", target_system: "SAP" } });
    expect((await dispatcher(h).dispatchOne(sap)).ack).toMatchObject({ error: { code: "NO_HANDLER" } });
  });

  it("serializes writes to the same target entity within a batch, and sends each ACK with its attempt", async () => {
    let open = 0;
    const h = fakeHandler({
      execute: async () => {
        open += 1;
        expect(open).toBe(1);
        await new Promise((r) => setTimeout(r, 20));
        open -= 1;
        return { externalRef: "RR-1", response: {} };
      },
    });
    const actions = [leased({ mutation_id: "MUT-00000001" }), leased({ mutation_id: "MUT-00000002", attempt: 1 })];
    const acks: string[] = [];
    const d = dispatcher(h, {
      nextActions: async () => ({ status: "OK", actions }),
      ackMutation: async (id, attempt) => (acks.push(`${id}#${attempt}`), okAck(id)),
    });
    expect(await d.tick()).toBe(2);
    expect(acks).toEqual(["MUT-00000001#1", "MUT-00000002#1"]);
  });

  it("dispatches nothing while Snowflake says dispatch is stopped", async () => {
    const h = fakeHandler();
    const d = dispatcher(h, { nextActions: async () => ({ status: "STOPPED", actions: [] }) });
    expect(await d.tick()).toBe(0);
    expect(h.calls).toEqual([]);
  });
});

describe("dispatcher against the real mock TMS", () => {
  let mock: ReturnType<typeof buildMockTms> | null = null;
  afterEach(async () => {
    await mock?.app.close();
    mock = null;
  });

  it("re-routes SHP-20261006-114 exactly once, even when the lease is retried", async () => {
    mock = buildMockTms();
    await mock.app.listen({ port: 0, host: "127.0.0.1" });
    const auth = { authorization: "Bearer mock-tms-token" };
    await mock.app.inject({ method: "POST", url: "/__sim/shipments", headers: auth, payload: { records: [{
      shipment_id: "SHP-20261006-114", carrier_party_id: "PARTY-SIERRA", origin_site_id: "SITE-EMERALD-PACK", destination_site_id: "SITE-SUMMIT-SLC",
      planned_departure_at: "2026-10-06T02:00:00Z", planned_arrival_at: "2026-10-07T06:00:00Z", reefer_device_id: "RF-114", truck_id: "TR-114",
      bol_setpoint_c: 0.5, lots: [{ lot_id: "L-A", kg: 4200 }], status: "IN_TRANSIT" }] } });
    const tms = new TmsClient({ baseUrl: `http://127.0.0.1:${(mock.app.server.address() as AddressInfo).port}`, token: "mock-tms-token" });
    const d = new Dispatcher({ id: "engine-1/dispatcher", port: fakePort({}), registry: new HandlerRegistry(carrierHandlers(tms) as ActionHandler<never>[]), log: silentLogger });
    const first = (await d.dispatchOne(leased())).ack!;
    expect(first).toMatchObject({ error: null, observed_before: { destination_site_id: "SITE-SUMMIT-SLC" }, observed_after: { destination_site_id: "SITE-BAYLINE-SAC" } });
    expect(firstMismatch(leased().intent.expected_after as Record<string, unknown>, first.observed_after!)).toBeNull();
    const retried = (await d.dispatchOne(leased({ attempt: 2 }))).ack!;
    expect(retried).toMatchObject({ error: null, external_ref: first.external_ref });
    const reroutes = (await mock.app.inject({ method: "GET", url: `/v1/reroutes?reference=${KEY}`, headers: auth })).json() as { data: unknown[] };
    expect(reroutes.data).toHaveLength(1);
  });
});

describe("live-trace relay", () => {
  it("serves a run's events to a token holder and resumes after Last-Event-ID", async () => {
    const hub = new TraceHub();
    hub.publish({ run_id: "RUN-00000210", seq: 0, at: "2026-10-06T07:05:01Z", kind: "STATUS", text: "Planning" });
    hub.publish({ run_id: "RUN-00000210", seq: 1, at: "2026-10-06T07:05:02Z", kind: "TOOL_USE", tool: { name: "GET_CASE_CONTEXT", tool_use_id: "tu_1" } });
    hub.end("RUN-00000210");
    const server = createRelayServer(hub, "relay-token");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/v1/runs/RUN-00000210/events`)).status).toBe(401);
      const resumed = await (await fetch(`${base}/v1/runs/RUN-00000210/events`, { headers: { authorization: "Bearer relay-token", "last-event-id": "0" } })).text();
      expect(resumed).toContain("id: 1");
      expect(resumed).not.toContain("id: 0\n");
      expect(resumed).toContain("event: agent.end");
    } finally {
      server.close();
    }
  });
});
