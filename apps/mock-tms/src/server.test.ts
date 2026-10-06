import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMockTms } from "./server.js";

const AUTH = { authorization: "Bearer mock-tms-token" };
const KEY = (n: number) => String(n).padStart(64, "0");
let mock: ReturnType<typeof buildMockTms>;

async function call(method: "GET" | "POST" | "PUT", url: string, payload?: Record<string, unknown>, headers: Record<string, string> = {}) {
  return mock.app.inject({ method, url, headers: { ...AUTH, ...headers }, ...(payload ? { payload } : {}) });
}

beforeEach(async () => {
  mock = buildMockTms();
  await mock.app.ready();
  await call("PUT", "/__sim/clock", { now: "2026-10-06T09:30:00Z" });
  await call("POST", "/__sim/shipments", {
    records: [
      {
        shipment_id: "SHP-A",
        carrier_party_id: "PARTY-SIERRA",
        origin_site_id: "SITE-EMERALD-PACK",
        destination_site_id: "SITE-SUMMIT-SLC",
        planned_departure_at: "2026-10-06T10:00:00Z",
        planned_arrival_at: "2026-10-07T01:00:00Z",
        reefer_device_id: "RF-114",
        truck_id: "TR-114",
        bol_setpoint_c: 0.5,
        lots: [{ lot_id: "L-A", kg: 4200 }],
      },
    ],
  });
});
afterEach(() => mock.app.close());

async function depart() {
  await call("PUT", "/__sim/clock", { now: "2026-10-06T10:00:00Z" });
  await call("POST", "/__sim/events", {
    records: [
      { event_id: "EV-1", shipment_id: "SHP-A", kind: "CUSTODY", at: "2026-10-06T10:00:00Z", custody_event_type: "LOAD", lot_id: "L-A", from_party_id: "PARTY-EMERALD-RIDGE", to_party_id: "PARTY-SIERRA", site_id: "SITE-EMERALD-PACK" },
      { event_id: "EV-2", shipment_id: "SHP-A", kind: "STATUS", at: "2026-10-06T10:00:00Z", status: "IN_TRANSIT", next_junction_site_id: "SITE-JCT-I80-SAC", eta_at: "2026-10-07T01:00:00Z" },
    ],
  });
}

describe("reads", () => {
  it("polls shipments by updated_since and events by recorded_at", async () => {
    const all = (await call("GET", "/v1/shipments")).json();
    expect(all.data[0]).toMatchObject({ shipment_id: "SHP-A", status: "PLANNED", planned_destination_site_id: "SITE-SUMMIT-SLC" });
    expect(all.data[0]).not.toHaveProperty("rev");
    const cursor = all.data[0].updated_at;
    expect((await call("GET", `/v1/shipments?updated_since=${cursor}`)).json().data).toHaveLength(0);
    await depart();
    const changed = (await call("GET", `/v1/shipments?updated_since=${cursor}`)).json().data;
    expect(changed[0]).toMatchObject({ status: "IN_TRANSIT", next_junction_site_id: "SITE-JCT-I80-SAC" });
    const events = (await call("GET", `/v1/events?since=${cursor}`)).json().data;
    expect(events.map((e: { event_id: string }) => e.event_id)).toEqual(["EV-1", "EV-2"]);
    expect(events[0].recorded_at > cursor).toBe(true);
  });

  it("records each simulator event once", async () => {
    await depart();
    await depart();
    expect((await call("GET", "/v1/events?since=2026-01-01T00:00:00Z")).json().data).toHaveLength(2);
  });

  it("needs the bearer token", async () => {
    const res = await mock.app.inject({ method: "GET", url: "/v1/shipments" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
  });
});

describe("re-route", () => {
  async function reroute(key: string, etag: string) {
    return call("POST", "/v1/shipments/SHP-A/reroute",
      { new_destination_site_id: "SITE-BAYLINE-SAC", reason: "spec infeasible at Summit", reference: "mut-reroute" },
      { "idempotency-key": key, "if-match": etag });
  }

  it("refuses until the shipment is in transit, then compare-and-sets on the ETag", async () => {
    const etag0 = String((await call("GET", "/v1/shipments/SHP-A")).headers.etag);
    expect((await reroute(KEY(1), etag0)).statusCode).toBe(409);
    await depart();
    expect((await reroute(KEY(2), etag0)).statusCode).toBe(412);
    const etag = String((await call("GET", "/v1/shipments/SHP-A")).headers.etag);
    const ok = await reroute(KEY(3), etag);
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toMatchObject({ status: "ACCEPTED", previous_destination_site_id: "SITE-SUMMIT-SLC" });
    // Same key again: the original answer, not a second re-route.
    const again = await reroute(KEY(3), etag);
    expect(again.json().reroute_id).toBe(ok.json().reroute_id);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect((await call("GET", "/v1/reroutes?reference=mut-reroute")).json().data).toHaveLength(1);
    expect((await call("GET", "/v1/shipments/SHP-A")).json().destination_site_id).toBe("SITE-BAYLINE-SAC");
  });

  it("closes the window once the junction is passed", async () => {
    await depart();
    await call("POST", "/__sim/events", { records: [{ event_id: "EV-3", shipment_id: "SHP-A", kind: "STATUS", at: "2026-10-06T13:00:00Z", status: "IN_TRANSIT", junction_passed: true }] });
    const etag = String((await call("GET", "/v1/shipments/SHP-A")).headers.etag);
    const res = await reroute(KEY(4), etag);
    expect(res.statusCode).toBe(409);
    expect(res.json().title).toBe("Re-route window closed");
  });

  it("forgets everything on reset, including lookups", async () => {
    await depart();
    const etag = String((await call("GET", "/v1/shipments/SHP-A")).headers.etag);
    await reroute(KEY(5), etag);
    await call("POST", "/__sim/reset", {});
    expect((await call("GET", "/v1/reroutes?reference=mut-reroute")).json().data).toHaveLength(0);
    expect((await call("GET", "/v1/shipments")).json().data).toHaveLength(0);
  });

  it("requires an idempotency key", async () => {
    const res = await call("POST", "/v1/shipments/SHP-A/reroute", { new_destination_site_id: "X", reason: "r", reference: "x" }, { "if-match": '"1"' });
    expect(res.statusCode).toBe(400);
  });
});

describe("claims, evidence and EDI", () => {
  it("upgrades a notice to a filed claim and finds it by reference", async () => {
    const notice = await call("POST", "/v1/claims",
      { shipment_id: "SHP-A", claimant_party_id: "PARTY-BHM", basis: "CARRIER_TEMPERATURE", notice_only: true, description: "notice", reference: "mut-notice" },
      { "idempotency-key": KEY(10) });
    expect(notice.json().status).toBe("NOTICE_RECEIVED");
    const filed = await call("POST", "/v1/claims",
      { shipment_id: "SHP-A", claimant_party_id: "PARTY-BHM", basis: "CARRIER_TEMPERATURE", notice_only: false, amount_usd: 3952, description: "claim", reference: "mut-file" },
      { "idempotency-key": KEY(11) });
    expect(filed.json()).toMatchObject({ claim_id: notice.json().claim_id, status: "FILED", amount_usd: 3952 });
    expect((await call("GET", "/v1/claims?reference=mut-file")).json().data).toHaveLength(1);
    const missingAmount = await call("POST", "/v1/claims",
      { shipment_id: "SHP-A", claimant_party_id: "PARTY-BHM", basis: "CARRIER_TEMPERATURE", notice_only: false, description: "x", reference: "r" },
      { "idempotency-key": KEY(12) });
    expect(missingAmount.statusCode).toBe(422);
  });

  it("serves claim responses by cursor", async () => {
    await call("POST", "/__sim/claim-responses", { records: [{ claim_id: "CLM-1", response_type: "DENIED", defense: "WARM_LOADING", at: "2026-10-20T10:00:00Z" }] });
    const data = (await call("GET", "/v1/claim-responses?since=2026-01-01T00:00:00Z")).json().data;
    expect(data[0]).toMatchObject({ response_type: "DENIED", defense: "WARM_LOADING" });
  });

  it("records evidence requests and EDI 865 messages", async () => {
    const er = await call("POST", "/v1/evidence-requests",
      { shipment_id: "SHP-A", evidence_type: "REEFER_DOWNLOAD", reason: "excursion", needed_by: "2026-10-07T00:00:00Z", reference: "mut-er" },
      { "idempotency-key": KEY(20) });
    expect(er.json().status).toBe("OPEN");
    const edi = await call("POST", "/edi/v1/messages",
      { standard: "X12", transaction_set: "865", receiver_party_id: "PARTY-SUMMIT", body: { line: "SO-6001-10" }, reference: "mut-865" },
      { "idempotency-key": KEY(21) });
    expect(edi.statusCode).toBe(202);
    expect((await call("GET", "/edi/v1/messages?reference=mut-865")).json().data).toHaveLength(1);
  });

  it("delivers webhooks with an HMAC signature", async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    await mock.app.close();
    mock = buildMockTms({ fetch: (async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response(null); }) as unknown as typeof fetch });
    await mock.app.ready();
    await call("POST", "/v1/webhooks", { url: "http://hook", events: ["shipment.status"], secret: "s" });
    await call("POST", "/__sim/shipments", { records: [{ shipment_id: "SHP-Z", carrier_party_id: "P", origin_site_id: "A", destination_site_id: "B", lots: [] }] });
    expect(sent).toHaveLength(1);
    expect((sent[0]!.init.headers as Record<string, string>)["X-Signature"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
