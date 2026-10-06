import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFilter } from "./filter.js";
import { buildMockS4 } from "./server.js";

const AUTH = { authorization: "Basic " + Buffer.from("BBC_CONNECTOR:mock").toString("base64") };
const SO = "/sap/opu/odata/sap/API_SALES_ORDER_SRV";
let mock: ReturnType<typeof buildMockS4>;

beforeEach(async () => {
  mock = buildMockS4();
  await mock.app.ready();
  await sim("PUT", "/__sim/clock", { now: "2026-10-05T18:00:00Z" });
  await sim("POST", "/__sim/sales-orders", {
    records: [
      {
        SalesOrder: "6001",
        SoldToParty: "100301",
        PurchaseOrderByCustomer: "SUMMIT-PO-88121",
        items: [
          {
            SalesOrderItem: "10",
            Material: "BB-EM-ORG-6OZ",
            RequestedQuantity: 4200,
            NetPriceAmount: 11.2,
            Batch: "L-A",
            ShipToParty: "500301",
            RequestedDeliveryDate: "2026-10-07T00:00:00Z",
            SDProcessStatus: "A",
          },
        ],
      },
    ],
  });
});
afterEach(() => mock.app.close());

async function sim(method: "PUT" | "POST", url: string, payload: Record<string, unknown>) {
  const res = await mock.app.inject({ method, url, payload, headers: AUTH });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function get(url: string, headers: Record<string, string> = {}) {
  return mock.app.inject({ method: "GET", url, headers: { ...AUTH, ...headers } });
}

async function csrf() {
  const res = await get(`${SO}/`, { "x-csrf-token": "Fetch" });
  return { "x-csrf-token": String(res.headers["x-csrf-token"]), cookie: String(res.headers["set-cookie"]).split(";")[0]! };
}

describe("reads", () => {
  it("serves SAP's envelope, Edm formats and metadata", async () => {
    const res = await get(`${SO}/A_SalesOrderItem?$inlinecount=allpages`);
    const body = res.json();
    expect(body.d.__count).toBe("1");
    const item = body.d.results[0];
    expect(item).toMatchObject({
      SalesOrder: "6001",
      SalesOrderItem: "10",
      RequestedQuantity: "4200.000",
      NetPriceAmount: "11.200",
      RequestedDeliveryDate: `/Date(${Date.parse("2026-10-07T00:00:00Z")})/`,
    });
    expect(item.LastChangeDateTime).toMatch(/^\/Date\(\d+\+0000\)\/$/);
    expect(item.__metadata.uri).toContain("A_SalesOrderItem(SalesOrder='6001',SalesOrderItem='10')");
    expect(res.headers.date).toBe(new Date("2026-10-05T18:00:00Z").toUTCString());
  });

  it("delta-filters on LastChangeDateTime and pages server-side", async () => {
    const records = Array.from({ length: 1200 }, (_, i) => ({
      InspectionLot: String(10000 + i),
      Material: "BB-EM-ORG-6OZ",
      Batch: `L-${i}`,
      Plant: "1000",
      InspectionLotType: "01",
    }));
    await sim("POST", "/__sim/inspection-lots", { records });
    const page1 = (await get("/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot?$orderby=LastChangeDateTime")).json();
    expect(page1.d.results).toHaveLength(500);
    const next = new URL(page1.d.__next);
    const page2 = (await get(next.pathname + next.search)).json();
    expect(page2.d.results[0].InspectionLot).toBe("10500");
    // The cursor is the last change seen: a strictly later read returns only newer records.
    const cursor = /\((\d+)\+0000\)/.exec(page1.d.results[499].LastChangeDateTime)![1];
    const iso = new Date(Number(cursor)).toISOString();
    const delta = (
      await get(
        `/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot?$filter=${encodeURIComponent(
          `LastChangeDateTime gt datetimeoffset'${iso}'`,
        )}&$inlinecount=allpages&$top=1`,
      )
    ).json();
    expect(delta.d.__count).toBe("700");
  });

  it("expands navigation properties and honours $select", async () => {
    const body = (await get(`${SO}/A_SalesOrder?$expand=to_Item&$select=SalesOrder,SoldToParty`)).json();
    expect(Object.keys(body.d.results[0]).sort()).toEqual(["SalesOrder", "SoldToParty", "__metadata", "to_Item"]);
    expect(body.d.results[0].to_Item.results[0].Batch).toBe("L-A");
  });

  it("refuses wrong credentials and unknown sets", async () => {
    expect((await mock.app.inject({ method: "GET", url: `${SO}/A_SalesOrder` })).statusCode).toBe(401);
    const res = await get(`${SO}/A_Nope`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message.value).toMatch(/Resource not found/);
  });
});

describe("writes", () => {
  const item = `${SO}/A_SalesOrderItem(SalesOrder='6001',SalesOrderItem='10')`;

  it("requires a CSRF token and session cookie", async () => {
    const res = await mock.app.inject({ method: "PATCH", url: item, headers: AUTH, payload: { Batch: "L-R1" } });
    expect(res.statusCode).toBe(403);
    expect(res.headers["x-csrf-token"]).toBe("Required");
  });

  it("compare-and-sets a sales order item with If-Match", async () => {
    const token = await csrf();
    const etag = String((await get(item)).headers.etag);
    const ok = await mock.app.inject({
      method: "PATCH",
      url: item,
      headers: { ...AUTH, ...token, "if-match": etag },
      payload: { Batch: "L-R1", YY1_BBCReference: "ref-1" },
    });
    expect(ok.statusCode).toBe(204);
    const stale = await mock.app.inject({
      method: "PATCH",
      url: item,
      headers: { ...AUTH, ...token, "if-match": etag },
      payload: { Batch: "L-R2" },
    });
    expect(stale.statusCode).toBe(412);
    const missing = await mock.app.inject({ method: "PATCH", url: item, headers: { ...AUTH, ...token }, payload: { Batch: "L-R2" } });
    expect(missing.statusCode).toBe(428);
    // The dispatcher's "did this already happen?" lookup by our reference.
    const found = (await get(`${SO}/A_SalesOrderItem?$filter=${encodeURIComponent("YY1_BBCReference eq 'ref-1'")}`)).json();
    expect(found.d.results.map((r: { Batch: string }) => r.Batch)).toEqual(["L-R1"]);
  });

  it("refuses to change fields the contract does not allow", async () => {
    const token = await csrf();
    const etag = String((await get(item)).headers.etag);
    const res = await mock.app.inject({
      method: "PATCH",
      url: item,
      headers: { ...AUTH, ...token, "if-match": etag },
      payload: { NetPriceAmount: "1.00" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a sales order with items (SO_CREATE) and rejects it (CANCEL_SO)", async () => {
    const token = await csrf();
    const res = await mock.app.inject({
      method: "POST",
      url: `${SO}/A_SalesOrder`,
      headers: { ...AUTH, ...token },
      payload: {
        SoldToParty: "100302",
        YY1_BBCReference: "mut-1",
        to_Item: { results: [{ Material: "BB-EM-ORG-6OZ", RequestedQuantity: "4200", NetPriceAmount: "10.64", Batch: "L-A" }] },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().d;
    expect(created.SalesOrder).toBe("7001"); // orders created through the API draw from their own number range
    expect(created.to_Item.results[0]).toMatchObject({ SalesOrderItem: "10", YY1_BBCReference: "mut-1" });
    const rejected = await mock.app.inject({
      method: "POST",
      url: `${SO}/RejectSalesOrder?SalesOrder='7001'`,
      headers: { ...AUTH, ...token },
    });
    expect(rejected.json().d.to_Item.results[0].SalesDocumentRjcnReason).toBe("Z1");
  });

  it("blocks stock with movement 344 and never lets stock go negative", async () => {
    await sim("PUT", "/__sim/stock", {
      records: [{ Material: "BB-EM-ORG-6OZ", Plant: "1000", StorageLocation: "0001", Batch: "L-R1", InventoryStockType: "01", quantity: 2000 }],
    });
    const token = await csrf();
    const post = (qty: number, ref: string) =>
      mock.app.inject({
        method: "POST",
        url: "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader",
        headers: { ...AUTH, ...token },
        payload: {
          GoodsMovementCode: "04",
          MaterialDocumentHeaderText: ref,
          to_MaterialDocumentItem: {
            results: [{ Material: "BB-EM-ORG-6OZ", Plant: "1000", StorageLocation: "0001", Batch: "L-R1", GoodsMovementType: "344", QuantityInEntryUnit: String(qty), EntryUnit: "KG" }],
          },
        },
      });
    expect((await post(1500, "mut-block")).statusCode).toBe(201);
    const deficit = await post(1000, "mut-again");
    expect(deficit.statusCode).toBe(400);
    expect(deficit.json().error.code).toBe("M7/021");
    const stock = (await get("/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod")).json().d.results;
    const byType = Object.fromEntries(stock.map((s: Record<string, string>) => [s.InventoryStockType, s.MatlWrhsStkQtyInMatlBaseUnit]));
    expect(byType).toEqual({ "01": "500.000", "07": "1500.000" });
    const lookup = (
      await get(`/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader?$filter=${encodeURIComponent("MaterialDocumentHeaderText eq 'mut-block'")}`)
    ).json();
    expect(lookup.d.results).toHaveLength(1);
  });

  it("keeps a sold-out batch in the stock list at zero, so snapshots report it", async () => {
    const row = { Material: "BB-EM-ORG-6OZ", Plant: "1000", StorageLocation: "0001", Batch: "L-R9", InventoryStockType: "01" };
    await sim("PUT", "/__sim/stock", { records: [{ ...row, quantity: 800 }] });
    await sim("PUT", "/__sim/stock", { records: [{ ...row, quantity: 0 }] });
    await sim("PUT", "/__sim/stock", { records: [{ ...row, Batch: "L-NEVER", quantity: 0 }] });
    const stock = (await get("/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod")).json().d.results;
    expect(stock.map((s: Record<string, string>) => [s.Batch, s.MatlWrhsStkQtyInMatlBaseUnit])).toEqual([["L-R9", "0.000"]]);
  });

  it("creates and deletes a delivery, but not after goods issue", async () => {
    const token = await csrf();
    const res = await mock.app.inject({
      method: "POST",
      url: "/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV/A_OutbDeliveryHeader",
      headers: { ...AUTH, ...token },
      payload: {
        ShipToParty: "500301",
        to_DeliveryDocumentItem: [{ ReferenceSDDocument: "6001", ReferenceSDDocumentItem: "10", Material: "BB-EM-ORG-6OZ", Batch: "L-R1", ActualDeliveryQuantity: "4200" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const doc = res.json().d.DeliveryDocument;
    const url = `/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV/A_OutbDeliveryHeader('${doc}')`;
    await sim("POST", "/__sim/deliveries", { records: [{ DeliveryDocument: doc, OverallGoodsMovementStatus: "C" }] });
    expect((await mock.app.inject({ method: "DELETE", url, headers: { ...AUTH, ...token } })).statusCode).toBe(409);
    await sim("POST", "/__sim/deliveries", { records: [{ DeliveryDocument: doc, OverallGoodsMovementStatus: "A" }] });
    expect((await mock.app.inject({ method: "DELETE", url, headers: { ...AUTH, ...token } })).statusCode).toBe(204);
  });

  it("posts a grower deduction as a credit memo and cancels it once", async () => {
    const token = await csrf();
    const base = "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV";
    const res = await mock.app.inject({
      method: "POST",
      url: `${base}/A_SupplierInvoice`,
      headers: { ...AUTH, ...token },
      payload: { InvoicingParty: "300101", InvoiceGrossAmount: "8400.00", IsInvoice: false, SupplierInvoiceIDByInvcgParty: "mut-ded" },
    });
    expect(res.statusCode).toBe(201);
    const { SupplierInvoice, FiscalYear } = res.json().d;
    const cancel = () =>
      mock.app.inject({
        method: "POST",
        url: `${base}/Cancel?SupplierInvoice='${SupplierInvoice}'&FiscalYear='${FiscalYear}'`,
        headers: { ...AUTH, ...token },
      });
    expect((await cancel()).statusCode).toBe(200);
    expect((await cancel()).statusCode).toBe(409);
  });
});

describe("simulator and faults", () => {
  it("stamps strictly increasing change times even when the clock stands still", async () => {
    await sim("POST", "/__sim/batches", {
      records: [
        { Material: "BB-EM-ORG-6OZ", BatchIdentifyingPlant: "2100", Batch: "L-A", Supplier: "300101", YY1_NetWeightKg: 4200 },
        { Material: "BB-EM-ORG-6OZ", BatchIdentifyingPlant: "2100", Batch: "L-B", Supplier: "300101", YY1_NetWeightKg: 3600 },
      ],
    });
    const rows = (await get("/sap/opu/odata/sap/API_BATCH_SRV/Batch?$orderby=LastChangeDateTime")).json().d.results;
    const stamps = rows.map((r: { LastChangeDateTime: string }) => Number(/\((\d+)/.exec(r.LastChangeDateTime)![1]));
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
  });

  it("fails on purpose when told to", async () => {
    await mock.app.inject({ method: "POST", url: "/__mock/faults", payload: { path: "A_SalesOrderItem", status: 503, count: 1 } });
    expect((await get(`${SO}/A_SalesOrderItem`)).statusCode).toBe(503);
    expect((await get(`${SO}/A_SalesOrderItem`)).statusCode).toBe(200);
  });
});

describe("$filter", () => {
  it("parses the contract's operators and literals", () => {
    expect(parseFilter("A eq 'it''s' and (B ge 3.5 and C lt datetimeoffset'2026-10-06T00:00:00Z')")).toMatchObject({ kind: "and" });
    expect(() => parseFilter("A contains 'x'")).toThrow(/unsupported operator/);
  });
});
