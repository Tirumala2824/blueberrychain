import type { AddressInfo } from "node:net";
import { TargetRejectedError } from "@blueberrychain/connector-sdk";
import { buildMockTms } from "@blueberrychain/mock-tms";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { carrierHandlers, type CarrierIntent } from "./actions.js";
import { TmsClient } from "./tms.js";

const AUTH = { authorization: "Bearer mock-tms-token" };
const KEY = (n: number) => String(n).padStart(64, "a");
let mock: ReturnType<typeof buildMockTms>;
let tms: TmsClient;

async function sim(method: "PUT" | "POST", url: string, payload: Record<string, unknown>) {
  const res = await mock.app.inject({ method, url, headers: AUTH, payload });
  expect(res.statusCode, res.body).toBe(200);
}

beforeEach(async () => {
  mock = buildMockTms();
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  tms = new TmsClient({ baseUrl: `http://127.0.0.1:${(mock.app.server.address() as AddressInfo).port}`, token: "mock-tms-token" });
  await sim("PUT", "/__sim/clock", { now: "2026-10-06T07:40:00Z" });
  await sim("POST", "/__sim/shipments", {
    records: [{
      shipment_id: "SHP-20261006-114", carrier_party_id: "PARTY-SIERRA", origin_site_id: "SITE-EMERALD-PACK",
      destination_site_id: "SITE-SUMMIT-SLC", planned_departure_at: "2026-10-06T02:00:00Z", planned_arrival_at: "2026-10-07T06:00:00Z",
      reefer_device_id: "RF-114", truck_id: "TR-114", bol_setpoint_c: 0.5, lots: [{ lot_id: "L-A", kg: 4200 }],
      status: "IN_TRANSIT", next_junction_site_id: "SITE-JCT-I80-SAC",
    }],
  });
});
afterEach(() => mock.app.close());

const handler = (type: string) => carrierHandlers(tms).find((h) => h.actionTypes.includes(type))!;
const intent = (action_type: string, n: number, payload: Record<string, unknown>, target = { type: "SHIPMENT", id: "SHP-20261006-114" }): CarrierIntent => ({
  action_type, idempotency_key: KEY(n), target_entity: target, payload, rec_id: "REC-00000044", case_id: "CASE-00000017",
});

describe("carrier handlers against the mock TMS", () => {
  it("re-routes with compare-and-set, reads back, and answers status by key", async () => {
    const h = handler("REROUTE");
    const i = intent("REROUTE", 1, { shipment_id: "SHP-20261006-114", lot_id: "L-A", new_destination_site_id: "SITE-BAYLINE-SAC", disposition: "REROUTE" });
    expect(await h.status(i, i.idempotency_key)).toEqual({ state: "UNKNOWN" });
    expect(await h.readBefore(i)).toEqual({ status: "IN_TRANSIT", destination_site_id: "SITE-SUMMIT-SLC" });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(externalRef).toMatch(/^RR-/);
    expect(await h.readAfter(i, externalRef)).toEqual({ status: "IN_TRANSIT", destination_site_id: "SITE-BAYLINE-SAC" });
    expect(await h.status(i, i.idempotency_key)).toMatchObject({ state: "APPLIED", externalRef });
    // a resend with the same key is the same request: the TMS replays its answer
    expect((await h.execute(i, i.idempotency_key)).externalRef).toBe(externalRef);
  });

  it("re-routes back to the destination the compensation restores", async () => {
    const out = intent("REROUTE", 6, { shipment_id: "SHP-20261006-114", new_destination_site_id: "SITE-BAYLINE-SAC" });
    await handler("REROUTE").readBefore(out);
    await handler("REROUTE").execute(out, out.idempotency_key);
    const h = handler("REROUTE_BACK");
    const back = intent("REROUTE_BACK", 7, { ...out.payload, restore: { destination_site_id: "SITE-SUMMIT-SLC", status: "IN_TRANSIT" } });
    expect(await h.readBefore(back)).toMatchObject({ destination_site_id: "SITE-BAYLINE-SAC" });
    const { externalRef } = await h.execute(back, back.idempotency_key);
    expect(await h.readAfter(back, externalRef)).toEqual({ status: "IN_TRANSIT", destination_site_id: "SITE-SUMMIT-SLC" });
    const noRestore = intent("REROUTE_BACK", 8, { shipment_id: "SHP-20261006-114" });
    await h.readBefore(noRestore);
    await expect(h.execute(noRestore, noRestore.idempotency_key)).rejects.toMatchObject({ code: "INTENT_INCOMPLETE" });
  });

  it("reports a definitive refusal as TargetRejectedError (never retried)", async () => {
    await sim("POST", "/__sim/shipments", { records: [{ shipment_id: "SHP-20261006-114", junction_passed: true }] });
    const h = handler("REROUTE");
    const i = intent("REROUTE", 2, { new_destination_site_id: "SITE-BAYLINE-SAC" });
    await h.readBefore(i);
    const error = await h.execute(i, i.idempotency_key).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TargetRejectedError);
    expect(error).toMatchObject({ status: 409, code: "TMS_409" });
  });

  it("refuses a stale ETag: the shipment changed between read and write", async () => {
    const h = handler("REROUTE");
    const i = intent("REROUTE", 3, { new_destination_site_id: "SITE-BAYLINE-SAC" });
    await h.readBefore(i);
    await sim("POST", "/__sim/shipments", { records: [{ shipment_id: "SHP-20261006-114", eta_at: "2026-10-07T07:00:00Z" }] });
    await expect(h.execute(i, i.idempotency_key)).rejects.toMatchObject({ status: 412 });
  });

  it("sends a claim notice, reports it as `notice_on_file`, and withdraws it by claim id", async () => {
    const h = handler("CLAIM_NOTICE");
    const claim = { type: "CLAIM", id: "CASE-00000017:PARTY-SIERRA" };
    const i = intent("CLAIM_NOTICE", 4, { counterparty_party_id: "PARTY-SIERRA", basis: "CARRIER_TEMPERATURE", shipment_id: "SHP-20261006-114" }, claim);
    expect(await h.readBefore(i)).toEqual({ notice_on_file: false, claim_status: null });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(await h.readAfter(i, externalRef)).toEqual({ notice_on_file: true, claim_status: "NOTICE_SENT" });
    expect(await h.status(i, i.idempotency_key)).toMatchObject({ state: "APPLIED", externalRef });
    const w = handler("WITHDRAW_NOTICE");
    const gatewayCompensation = intent("WITHDRAW_NOTICE", 9, { ...i.payload, restore: { notice_on_file: false } }, claim);
    await expect(w.readBefore(gatewayCompensation)).rejects.toMatchObject({ code: "INTENT_INCOMPLETE" });
    const withId = intent("WITHDRAW_NOTICE", 10, { ...i.payload, carrier_claim_id: externalRef }, claim);
    expect(await w.readBefore(withId)).toEqual({ notice_on_file: true, claim_status: "NOTICE_SENT" });
    await w.execute(withId, withId.idempotency_key);
    expect(await w.readAfter(withId, externalRef)).toEqual({ notice_on_file: false, claim_status: "WITHDRAWN" });
  });

  it("sends an EDI 865 re-promise and reads what the TMS stored", async () => {
    const h = handler("REPROMISE_NOTICE");
    const i = intent("REPROMISE_NOTICE", 5, { customer_party_id: "PARTY-SUMMIT", repromise_at: "2026-10-08T10:00:00Z" }, { type: "SALES_ORDER_ITEM", id: "SO-6002-10" });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(externalRef).toMatch(/^EDI-/);
    expect(await h.readAfter(i, externalRef)).toEqual({ delivery_status: "DELIVERED", promised_at: "2026-10-08T10:00:00Z" });
  });
});
