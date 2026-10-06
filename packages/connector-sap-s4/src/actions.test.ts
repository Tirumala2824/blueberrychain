import type { AddressInfo } from "node:net";
import { TargetRejectedError } from "@blueberrychain/connector-sdk";
import { buildMockS4 } from "@blueberrychain/mock-s4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ODataWriter, sapHandlers, sapReference, type SapIntent } from "./actions.js";

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

const handler = (type: string) => sapHandlers(writer).find((h) => h.actionTypes.includes(type))!;
const stockIntent = (n: number, kg = 3600): SapIntent => ({
  action_type: "STOCK_BLOCK", idempotency_key: KEY(n), target_entity: { type: "LOT_STOCK", id: "L-B@SITE-CVDC-TRACY" },
  payload: { material: "BB-DK-ORG-6OZ", plant: "1000", storage_location: "0001", batch: "L-B", kg },
});

describe("SAP handlers against the mock S/4", () => {
  it("blocks stock with movement 344 under a CSRF session, and finds it again by reference", async () => {
    const h = handler("STOCK_BLOCK");
    const i = stockIntent(1);
    expect(await h.readBefore(i)).toEqual({ unrestricted_kg: 3600, restricted_kg: 0 });
    expect(await h.status(i, i.idempotency_key)).toEqual({ state: "UNKNOWN" });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(await h.readAfter(i, externalRef)).toEqual({ unrestricted_kg: 0, restricted_kg: 3600 });
    expect(await h.status(i, i.idempotency_key)).toEqual({ state: "APPLIED", externalRef });
    expect(sapReference(i.idempotency_key)).toHaveLength(25);
  });

  it("rejects a block larger than the unrestricted stock (never retried)", async () => {
    const h = handler("STOCK_BLOCK");
    const i = stockIntent(2, 9000);
    await expect(h.execute(i, i.idempotency_key)).rejects.toBeInstanceOf(TargetRejectedError);
  });

  it("changes a sales order line with If-Match and stamps our reference", async () => {
    const h = handler("SO_CHANGE");
    const i: SapIntent = {
      action_type: "SO_CHANGE", idempotency_key: KEY(3), target_entity: { type: "SALES_ORDER_ITEM", id: "SO-6002-10" },
      payload: { sales_order: "6002", sales_order_item: "10", changes: { requested_delivery_date: "2026-10-08T00:00:00Z" } },
    };
    const before = await h.readBefore(i);
    expect(before).toMatchObject({ batch: "L-B", requested_quantity_kg: 3600 });
    const { externalRef } = await h.execute(i, i.idempotency_key);
    expect(externalRef).toBe("6002/10");
    expect((await h.readAfter(i, externalRef))["requested_delivery_date"]).not.toEqual(before["requested_delivery_date"]);
    expect(await h.status(i, i.idempotency_key)).toMatchObject({ state: "APPLIED" });
  });

  it("refuses a line change when the line changed since it was read (412)", async () => {
    const h = handler("SO_CHANGE");
    const i: SapIntent = {
      action_type: "SO_CHANGE", idempotency_key: KEY(4), target_entity: { type: "SALES_ORDER_ITEM", id: "SO-6002-10" },
      payload: { sales_order: "6002", sales_order_item: "10", changes: { batch: "L-CV-0912" } },
    };
    await h.readBefore(i);
    await sim("POST", "/__sim/sales-orders", { records: [{ SalesOrder: "6002", SoldToParty: "100301", items: [{ SalesOrderItem: "10", RequestedQuantity: 3000 }] }] });
    await expect(h.execute(i, i.idempotency_key)).rejects.toMatchObject({ status: 412 });
  });
});
