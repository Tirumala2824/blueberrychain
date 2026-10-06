import type { AddressInfo } from "node:net";
import { type BusinessEventRow, MemorySink, syncSource } from "@blueberrychain/connector-sdk";
import { buildMockTms } from "@blueberrychain/mock-tms";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CarrierSource } from "./source.js";
import { TmsClient } from "./tms.js";

const AUTH = { authorization: "Bearer mock-tms-token" };
let mock: ReturnType<typeof buildMockTms>;
let base: string;

async function sim(method: "PUT" | "POST", url: string, payload: Record<string, unknown>) {
  const res = await mock.app.inject({ method, url, headers: AUTH, payload });
  expect(res.statusCode, res.body).toBe(200);
}

beforeEach(async () => {
  mock = buildMockTms();
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(mock.app.server.address() as AddressInfo).port}`;
  await sim("PUT", "/__sim/clock", { now: "2026-10-06T09:30:00Z" });
  await sim("POST", "/__sim/shipments", {
    records: [{
      shipment_id: "SHP-A", carrier_party_id: "PARTY-SIERRA", origin_site_id: "SITE-EMERALD-PACK",
      destination_site_id: "SITE-SUMMIT-SLC", planned_departure_at: "2026-10-06T10:00:00Z",
      planned_arrival_at: "2026-10-07T01:00:00Z", reefer_device_id: "RF-114", truck_id: "TR-114",
      bol_setpoint_c: 0.5, lots: [{ lot_id: "L-A", kg: 4200 }],
    }],
  });
  await sim("PUT", "/__sim/clock", { now: "2026-10-06T10:00:00Z" });
  await sim("POST", "/__sim/events", {
    records: [
      { event_id: "EV-1", shipment_id: "SHP-A", kind: "CUSTODY", at: "2026-10-06T10:00:00Z", custody_event_type: "LOAD",
        lot_id: "L-A", from_party_id: "PARTY-EMERALD-RIDGE", to_party_id: "PARTY-SIERRA", site_id: "SITE-EMERALD-PACK" },
      { event_id: "EV-2", shipment_id: "SHP-A", kind: "STATUS", at: "2026-10-06T10:00:00Z", status: "IN_TRANSIT",
        lat: 36.521, lon: -119.548, next_junction_site_id: "SITE-JCT-I80-SAC", eta_at: "2026-10-07T01:00:00Z" },
    ],
  });
});
afterEach(() => mock.app.close());

const source = () => new CarrierSource(new TmsClient({ baseUrl: base, token: "mock-tms-token" }), { connectorId: "carrier-tms", provenance: "SIMULATION_LIVE" });
const of = (sink: MemorySink, type: string) =>
  [...sink.tables.BUSINESS_EVENTS.values()].map((r) => r as BusinessEventRow).filter((r) => r.entity_type === type);

describe("carrier connector", () => {
  it("lands shipments, status and custody as contract-valid business events", async () => {
    const sink = new MemorySink("carrier-tms");
    await syncSource(source(), sink);
    expect(sink.deadLetters).toEqual([]);
    const [shipment] = of(sink, "SHIPMENT");
    expect(shipment!.payload).toMatchObject({
      shipment_id: "SHP-A", carrier_party_id: "PARTY-SIERRA", destination_site_id: "SITE-SUMMIT-SLC",
      reefer_device_id: "RF-114", bol_setpoint_c: 0.5, lots: [{ lot_id: "L-A", kg: 4200 }], status: "IN_TRANSIT",
    });
    const [custody] = of(sink, "CUSTODY_EVENT");
    expect(custody!.payload).toMatchObject({ event_type: "LOAD", from_party_id: "PARTY-EMERALD-RIDGE", to_party_id: "PARTY-SIERRA", lot_id: "L-A" });
    const statuses = of(sink, "SHIPMENT_STATUS").map((r) => r.payload as Record<string, unknown>);
    expect(statuses.some((s) => s.lat === 36.521 && s.status === "IN_TRANSIT")).toBe(true);
    expect(statuses.some((s) => s.next_junction_site_id === "SITE-JCT-I80-SAC")).toBe(true);
  });

  it("keeps the planned destination on the plan and the new one on the status after a re-route", async () => {
    const sink = new MemorySink("carrier-tms");
    await syncSource(source(), sink);
    const etag = String((await mock.app.inject({ method: "GET", url: "/v1/shipments/SHP-A", headers: AUTH })).headers.etag);
    const res = await mock.app.inject({
      method: "POST", url: "/v1/shipments/SHP-A/reroute",
      headers: { ...AUTH, "idempotency-key": "a".repeat(64), "if-match": etag },
      payload: { new_destination_site_id: "SITE-BAYLINE-SAC", reason: "spec", reference: "mut-1" },
    });
    expect(res.statusCode).toBe(202);
    const reports = await syncSource(source(), sink);
    expect(reports.find((r) => r.stream === "shipments")!.rows).toBe(2);
    const plans = of(sink, "SHIPMENT").map((r) => (r.payload as Record<string, unknown>).destination_site_id);
    expect(new Set(plans)).toEqual(new Set(["SITE-SUMMIT-SLC"]));
    const latest = of(sink, "SHIPMENT_STATUS").map((r) => r.payload as Record<string, unknown>).at(-1)!;
    expect(latest.destination_site_id).toBe("SITE-BAYLINE-SAC");
  });

  it("never re-reads events it already committed, but still sees late ones", async () => {
    const sink = new MemorySink("carrier-tms");
    await syncSource(source(), sink);
    // An event that happened earlier but was recorded later (e.g. a driver app syncing late).
    await sim("PUT", "/__sim/clock", { now: "2026-10-06T12:00:00Z" });
    await sim("POST", "/__sim/events", {
      records: [{ event_id: "EV-LATE", shipment_id: "SHP-A", kind: "STATUS", at: "2026-10-06T10:30:00Z", status: "IN_TRANSIT", lat: 37.0, lon: -120.0 }],
    });
    const events = (await syncSource(source(), sink)).find((r) => r.stream === "events")!;
    expect(events).toMatchObject({ rows: 1, inserted: 1, duplicates: 0 });
  });

  it("resolves the counterparty of a claim response through its shipment", async () => {
    const claim = await mock.app.inject({
      method: "POST", url: "/v1/claims", headers: { ...AUTH, "idempotency-key": "b".repeat(64) },
      payload: { shipment_id: "SHP-A", claimant_party_id: "PARTY-BHM", basis: "CARRIER_TEMPERATURE", notice_only: true, description: "n", reference: "mut-n" },
    });
    const claimId = claim.json().claim_id;
    await sim("POST", "/__sim/claim-responses", {
      records: [
        { claim_id: claimId, response_type: "DENIED", defense: "WARM_LOADING", text: "Product was tendered warm.", at: "2026-10-20T10:00:00Z" },
        { claim_id: "CLM-UNKNOWN", response_type: "ACKNOWLEDGED", at: "2026-10-20T10:00:00Z" },
      ],
    });
    const sink = new MemorySink("carrier-tms");
    const src = source();
    await syncSource(src, sink);
    const [response] = of(sink, "CLAIM_RESPONSE");
    expect(response!.payload).toMatchObject({ claim_ref: claimId, counterparty_party_id: "PARTY-SIERRA", defense: "WARM_LOADING" });
    expect(src.skipped).toEqual([{ stream: "claim_responses", reason: "unknown claim CLM-UNKNOWN" }]);
  });
});
