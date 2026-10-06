import type { AddressInfo } from "node:net";
import { type BusinessEventRow, MemorySink, syncSource } from "@blueberrychain/connector-sdk";
import { buildMockS4 } from "@blueberrychain/mock-s4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeyMap } from "./keymap.js";
import { ODataClient } from "./odata.js";
import { SapS4Source } from "./source.js";

const KEYS: KeyMap = {
  business_partner: { "100301": "PARTY-SUMMIT", "300101": "PARTY-EMERALD-RIDGE" },
  plant: { "1000": "SITE-CVDC-TRACY", "2100": "SITE-EMERALD-PACK" },
  material: { "BB-EM-ORG-6OZ": "BB-EMERALD-ORG-12x6" },
  ship_to: { "500301": "SITE-SUMMIT-SLC" },
  harvest_block: { "R14-B7": "SITE-RANCH14-B7" },
};
const AUTH = { authorization: "Basic " + Buffer.from("BBC_CONNECTOR:mock").toString("base64") };

let mock: ReturnType<typeof buildMockS4>;
let base: string;

async function sim(method: "PUT" | "POST", url: string, payload: Record<string, unknown>) {
  const res = await mock.app.inject({ method, url, headers: AUTH, payload });
  expect(res.statusCode, res.body).toBe(200);
}

beforeEach(async () => {
  mock = buildMockS4();
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(mock.app.server.address() as AddressInfo).port}/sap/opu/odata/sap`;
  await sim("PUT", "/__sim/clock", { now: "2026-10-01T09:00:00Z" });
  await sim("POST", "/__sim/batches", {
    records: [
      {
        Material: "BB-EM-ORG-6OZ", BatchIdentifyingPlant: "2100", Batch: "L-A", Supplier: "300101",
        YY1_HarvestBlock: "R14-B7", YY1_HarvestDateTime: "2026-10-01T05:30:00Z", YY1_PackedDateTime: "2026-10-01T08:00:00Z",
        YY1_NetWeightKg: 4200, YY1_Organic: "X",
      },
    ],
  });
  await sim("POST", "/__sim/sales-orders", {
    records: [
      {
        SalesOrder: "6001", SoldToParty: "100301",
        items: [{ SalesOrderItem: "10", Material: "BB-EM-ORG-6OZ", RequestedQuantity: 4200, NetPriceAmount: 11.2, Batch: "L-A",
                  ShipToParty: "500301", RequestedDeliveryDate: "2026-10-07T00:00:00Z", SDProcessStatus: "A" }],
      },
    ],
  });
  await sim("POST", "/__sim/deliveries", {
    records: [
      {
        DeliveryDocument: "80000101", ShipToParty: "500301", PlannedGoodsIssueDate: "2026-10-06T10:00:00Z",
        OverallGoodsMovementStatus: "A", YY1_TMSShipment: "SHP-A",
        items: [{ DeliveryDocumentItem: "10", ReferenceSDDocument: "6001", ReferenceSDDocumentItem: "10", Material: "BB-EM-ORG-6OZ", Batch: "L-A", ActualDeliveryQuantity: 4200 }],
      },
    ],
  });
  await sim("PUT", "/__sim/stock", {
    records: [{ Material: "BB-EM-ORG-6OZ", Plant: "1000", StorageLocation: "0001", Batch: "L-R1", InventoryStockType: "01", quantity: 3000 }],
  });
  await sim("POST", "/__sim/inspection-lots", {
    records: [
      { InspectionLot: "30000001", Material: "BB-EM-ORG-6OZ", Batch: "L-A", Plant: "2100", InspectionLotType: "89",
        InspectionLotUsageDecisionCode: "A", YY1_InspectedAt: "2026-10-01T08:30:00Z", YY1_PulpTempC: 1.0, YY1_InspectorName: "M. Ortega" },
      { InspectionLot: "30000002", Material: "BB-EM-ORG-6OZ", Batch: "L-A", Plant: "2100", InspectionLotType: "04" },
    ],
  });
});
afterEach(() => mock.app.close());

function source(skips: string[] = [], pageSize = 200) {
  return new SapS4Source(
    new ODataClient({ baseUrl: base, user: "BBC_CONNECTOR", password: "mock" }),
    { connectorId: "sap-s4", keys: KEYS, provenance: "SIMULATION_LIVE" },
    { pageSize, stockEveryMs: 15 * 60_000, onSkip: (_s, reason) => skips.push(reason) },
  );
}

const payloads = (sink: MemorySink, type: string) =>
  [...sink.tables.BUSINESS_EVENTS.values()]
    .map((r) => r as BusinessEventRow)
    .filter((r) => r.entity_type === type)
    .map((r) => r.payload as Record<string, unknown>);

describe("SAP S/4 connector", () => {
  it("lands every entity as a contract-valid business event", async () => {
    const sink = new MemorySink("sap-s4");
    const skips: string[] = [];
    const reports = await syncSource(source(skips), sink);
    expect(sink.deadLetters).toEqual([]); // MemorySink applies the server's contract checks
    expect(Object.fromEntries(reports.map((r) => [r.stream, r.inserted]))).toEqual({
      batches: 1, sales_order_items: 1, deliveries: 1, inspection_lots: 1, stock: 1,
    });
    expect(skips).toEqual(["no usage decision yet"]);
    expect(payloads(sink, "LOT")[0]).toMatchObject({
      lot_id: "L-A", product_id: "BB-EMERALD-ORG-12x6", grower_party_id: "PARTY-EMERALD-RIDGE",
      harvest_site_id: "SITE-RANCH14-B7", packhouse_site_id: "SITE-EMERALD-PACK", kg: 4200, organic: true,
      harvest_at: "2026-10-01T05:30:00.000Z",
    });
    expect(payloads(sink, "SALES_ORDER_ITEM")[0]).toMatchObject({
      order_line_id: "SO-6001-10", customer_party_id: "PARTY-SUMMIT", ship_to_site_id: "SITE-SUMMIT-SLC",
      kg: 4200, price_usd_per_kg: 11.2, status: "ALLOCATED", assigned_lot_id: "L-A",
    });
    expect(payloads(sink, "DELIVERY")[0]).toMatchObject({
      delivery_id: "DLV-80000101-10", order_line_id: "SO-6001-10", lot_id: "L-A", shipment_id: "SHP-A", status: "CREATED",
    });
    expect(payloads(sink, "INSPECTION_RESULT")[0]).toMatchObject({
      inspection_id: "QC-30000001", site_id: "SITE-EMERALD-PACK", inspection_type: "ORIGIN", accepted: true, pulp_c: 1,
    });
    expect(payloads(sink, "STOCK_SNAPSHOT")[0]).toMatchObject({
      site_id: "SITE-CVDC-TRACY", lot_id: "L-R1", kg: 3000, stock_status: "UNRESTRICTED", snapshot_at: "2026-10-01T09:00:00.000Z",
    });
  });

  it("reads only what changed since the committed cursor", async () => {
    const sink = new MemorySink("sap-s4");
    await syncSource(source(), sink);
    const before = sink.tables.BUSINESS_EVENTS.size;
    await sim("PUT", "/__sim/clock", { now: "2026-10-06T10:05:00Z" });
    await sim("POST", "/__sim/deliveries", { records: [{ DeliveryDocument: "80000101", OverallGoodsMovementStatus: "C" }] });
    const reports = await syncSource(source(), sink);
    const byStream = Object.fromEntries(reports.map((r) => [r.stream, r.rows]));
    expect(byStream).toMatchObject({ batches: 0, sales_order_items: 0, deliveries: 1, inspection_lots: 0 });
    expect(payloads(sink, "DELIVERY").map((p) => p.status).sort()).toEqual(["CREATED", "GOODS_ISSUED"]);
    // Stock: a new snapshot because more than 15 server minutes passed.
    expect(byStream.stock).toBe(1);
    expect(sink.tables.BUSINESS_EVENTS.size).toBe(before + 2);
  });

  it("takes stock snapshots no more often than configured", async () => {
    const sink = new MemorySink("sap-s4");
    await syncSource(source(), sink);
    await sim("PUT", "/__sim/clock", { now: "2026-10-01T09:05:00Z" });
    const reports = await syncSource(source(), sink);
    expect(reports.find((r) => r.stream === "stock")!.rows).toBe(0);
  });

  it("pages through large deltas without losing or repeating records", async () => {
    const records = Array.from({ length: 450 }, (_, i) => ({
      Material: "BB-EM-ORG-6OZ", BatchIdentifyingPlant: "2100", Batch: `L-${1000 + i}`, Supplier: "300101",
      YY1_HarvestBlock: "R14-B7", YY1_HarvestDateTime: "2026-10-01T05:30:00Z", YY1_NetWeightKg: 1000, YY1_Organic: "X",
    }));
    await sim("POST", "/__sim/batches", { records });
    const sink = new MemorySink("sap-s4");
    const report = (await syncSource(source([], 100), sink)).find((r) => r.stream === "batches")!;
    expect(report).toMatchObject({ pages: 5, rows: 451, inserted: 451, duplicates: 0 });
  });

  it("skips records whose SAP keys have no mapping, and says so", async () => {
    await sim("POST", "/__sim/batches", {
      records: [{ Material: "UNKNOWN-MAT", BatchIdentifyingPlant: "2100", Batch: "L-X", Supplier: "300101",
                  YY1_HarvestBlock: "R14-B7", YY1_HarvestDateTime: "2026-10-01T05:30:00Z", YY1_NetWeightKg: 1 }],
    });
    const skips: string[] = [];
    await syncSource(source(skips), new MemorySink("sap-s4"));
    expect(skips).toContain("no material mapping for SAP key 'UNKNOWN-MAT'");
  });

  it("replays a re-read page as duplicates", async () => {
    const sink = new MemorySink("sap-s4");
    await syncSource(source(), sink);
    sink.cursorState.clear(); // as if the cursor commit was lost
    const reports = await syncSource(source(), sink);
    const batches = reports.find((r) => r.stream === "batches")!;
    expect(batches).toMatchObject({ inserted: 0, duplicates: 1 });
  });
});
