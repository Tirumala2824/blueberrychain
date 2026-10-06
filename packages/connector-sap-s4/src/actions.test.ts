import type { AddressInfo } from "node:net";
import { TargetRejectedError } from "@blueberrychain/connector-sdk";
import { buildMockS4 } from "@blueberrychain/mock-s4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ODataWriter, sapHandlers, sapReference, type SapIntent } from "./actions.js";
import type { KeyMap } from "./keymap.js";

const AUTH = { authorization: "Basic " + Buffer.from("BBC_CONNECTOR:mock").toString("base64") };
const KEY = (n: number) => String(n).padStart(64, "b");
let mock: ReturnType<typeof buildMockS4>;
let writer: ODataWriter;

async function sim(method: "PUT" | "POST", url: string, payload: Record<string, unknown>) {
  const res = await mock.app.inject({ method, url, headers: AUTH, payload });
  expect(res.statusCode, res.body).toBe(200);
}

beforeEach(async () => {
  mock = buildMockS4();
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  writer = new ODataWriter({ baseUrl: `http://127.0.0.1:${(mock.app.server.address() as AddressInfo).port}/sap/opu/odata/sap`, user: "BBC_CONNECTOR", password: "mock" });
  await sim("PUT", "/__sim/clock", { now: "2026-10-06T07:30:00Z" });
  await sim("PUT", "/__sim/stock", {
    records: [{ Material: "BB-DK-ORG-6OZ", Plant: "1000", StorageLocation: "0001", Batch: "L-B", InventoryStockType: "01", quantity: 3600 }],
  });
  await sim("POST", "/__sim/sales-orders", {
    records: [{ SalesOrder: "6002", SoldToParty: "100301", items: [{ SalesOrderItem: "10", Material: "BB-DK-ORG-6OZ", RequestedQuantity: 3600,
      NetPriceAmount: 11.2, Batch: "L-B", ShipToParty: "500301", RequestedDeliveryDate: "2026-10-07T00:00:00Z", SDProcessStatus: "A" }] }],
  });
});
afterEach(() => mock.app.close());

const KEYS: KeyMap = { business_partner: {}, plant: { "1000": "SITE-CVDC-TRACY" }, material: {}, ship_to: {}, harvest_block: {} };
const handler = (type: string) => sapHandlers(writer, KEYS).find((h) => h.actionTypes.includes(type))!;
// What the gateway composes (python/bbc_toolkit: stages.bundle_actions, gateway_procs._compensate).
const stockIntent = (n: number, kg = 3600, site = "SITE-CVDC-TRACY"): SapIntent => ({
  action_type: "STOCK_BLOCK", idempotency_key: KEY(n), target_entity: { type: "LOT_STOCK", id: `L-B@${site}` },
  payload: { lot_id: "L-B", site_id: site, kg },
});
const lineIntent = (action_type: string, n: number, payload: Record<string, unknown>): SapIntent => ({
  action_type, idempotency_key: KEY(n), target_entity: { type: "SALES_ORDER_ITEM", id: "SO-6002-10" }, payload: { order_line_id: "SO-6002-10", ...payload },
});

describe("SAP handlers against the mock S/4", () => {
  it("blocks stock with movement 344 under a CSRF session, reports it as `blocked`, and finds it again by reference", async () => {
    const h = handler("STOCK_BLOCK");
    const i = stockIntent(1);
    expect(await h.readBefore(i)).toEqual({ blocked: false, unrestricted_kg: 3600, blocked_kg: 0 });
    expect(await h.status(i, i.idempotency_key)).toEqual({ state: "UNKNOWN" });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(await h.readAfter(i, externalRef)).toEqual({ blocked: true, unrestricted_kg: 0, blocked_kg: 3600 });
    expect(await h.status(i, i.idempotency_key)).toEqual({ state: "APPLIED", externalRef });
    expect(sapReference(i.idempotency_key)).toHaveLength(25);
    const undo = handler("STOCK_UNBLOCK");
    const back = { ...i, action_type: "STOCK_UNBLOCK", idempotency_key: KEY(11), payload: { ...i.payload, restore: { blocked: false } } };
    await undo.readBefore(back);
    const r = await undo.execute(back, back.idempotency_key);
    expect(await undo.readAfter(back, r.externalRef)).toMatchObject({ blocked: false, unrestricted_kg: 3600 });
  });

  it("rejects a block larger than the unrestricted stock (never retried)", async () => {
    const h = handler("STOCK_BLOCK");
    const i = stockIntent(2, 9000);
    await expect(h.execute(i, i.idempotency_key)).rejects.toBeInstanceOf(TargetRejectedError);
  });

  it("refuses an intent it can't map to SAP, before writing anything", async () => {
    await expect(handler("STOCK_BLOCK").readBefore(stockIntent(3, 3600, "SITE-NOWHERE"))).rejects.toMatchObject({ code: "INTENT_INCOMPLETE" });
    await expect(handler("SO_REVERT").execute(lineIntent("SO_REVERT", 4, { kg: 3000 }), KEY(4))).rejects.toMatchObject({ code: "INTENT_INCOMPLETE" });
  });

  it("changes a line's quantity with If-Match, stamps our reference, and reports `kg`", async () => {
    const h = handler("SO_CHANGE");
    const i = lineIntent("SO_CHANGE", 5, { kg: 3000 });
    expect(await h.readBefore(i)).toMatchObject({ kg: 3600, assigned_lot_id: "L-B" });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(externalRef).toBe("6002/10");
    expect(await h.readAfter(i, externalRef)).toMatchObject({ kg: 3000 });
    expect(await h.status(i, i.idempotency_key)).toMatchObject({ state: "APPLIED" });
    const revert = lineIntent("SO_REVERT", 6, { kg: 3000, restore: { kg: 3600 } });
    await handler("SO_REVERT").readBefore(revert);
    await handler("SO_REVERT").execute(revert, revert.idempotency_key);
    expect(await handler("SO_REVERT").readAfter(revert, externalRef)).toMatchObject({ kg: 3600 });
  });

  it("allocates a replacement lot to the line and deallocates it back (`assigned_lot_id`)", async () => {
    const alloc = lineIntent("REPLACEMENT_ALLOCATION", 7, { replacement_lot_id: "L-CV-0912", from_site_id: "SITE-CVDC-TRACY", kg: 3600 });
    const h = handler("REPLACEMENT_ALLOCATION");
    expect(await h.readBefore(alloc)).toMatchObject({ assigned_lot_id: "L-B" });
    const { externalRef } = await h.execute(alloc, alloc.idempotency_key);
    expect(await h.readAfter(alloc, externalRef)).toMatchObject({ assigned_lot_id: "L-CV-0912" });
    const back = lineIntent("DEALLOCATE", 8, { ...alloc.payload, restore: { assigned_lot_id: "L-B" } });
    await handler("DEALLOCATE").readBefore(back);
    await handler("DEALLOCATE").execute(back, back.idempotency_key);
    expect(await handler("DEALLOCATE").readAfter(back, externalRef)).toMatchObject({ assigned_lot_id: "L-B" });
  });

  it("refuses a line change when the line changed since it was read (412)", async () => {
    const h = handler("SO_CHANGE");
    const i = lineIntent("SO_CHANGE", 9, { kg: 3200 });
    await h.readBefore(i);
    await sim("POST", "/__sim/sales-orders", { records: [{ SalesOrder: "6002", SoldToParty: "100301", items: [{ SalesOrderItem: "10", RequestedQuantity: 3000 }] }] });
    await expect(h.execute(i, i.idempotency_key)).rejects.toMatchObject({ status: 412 });
  });
});
