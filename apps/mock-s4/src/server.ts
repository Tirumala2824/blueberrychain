/**
 * Mock SAP S/4HANA: the OData v2 subset of contracts/apis/mock-s4.odata.md.
 *
 * Connector-facing: delta reads with $filter / $orderby / $top / $skip / $select /
 * $expand / $inlinecount and server-driven paging (500 rows). Dispatcher-facing: the
 * CSRF fetch-then-modify flow, ETag compare-and-set (412), lookups by our reference,
 * and SAP-style errors. Simulator-facing: /__sim/* (not part of the contract).
 */

import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { coerce, EdmError, type Entity, serialize } from "./edm.js";
import { matches, parseFilter } from "./filter.js";
import { ConflictError, SETS, Store } from "./store.js";

const BASE = "/sap/opu/odata/sap";
const PAGE = 500;
const CSRF_TTL_MS = 30 * 60 * 1000;

export interface MockS4Options {
  user?: string;
  password?: string;
  store?: Store;
  logger?: boolean;
}

interface Fault {
  method?: string;
  path: string;
  status: number;
  count: number;
  message?: string;
}

class ODataError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

function sendError(reply: FastifyReply, error: ODataError) {
  for (const [k, v] of Object.entries(error.headers)) reply.header(k, v);
  return reply.code(error.status).send({ error: { code: error.code, message: { lang: "en", value: error.message } } });
}

/** "A_SalesOrderItem(SalesOrder='6001',SalesOrderItem='10')" -> set + key values. */
function parseResource(resource: string): { set: string; key: Record<string, string> | null } {
  const m = /^([A-Za-z_]\w*)(?:\((.*)\))?$/.exec(decodeURIComponent(resource));
  if (!m) throw new ODataError(404, "/IWFND/MED/170", `Resource not found: ${resource}`);
  const set = m[1]!;
  if (m[2] === undefined) return { set, key: null };
  const def = SETS[set];
  if (!def) throw new ODataError(404, "/IWFND/MED/170", `Resource not found for segment ${set}`);
  const parts = m[2].split(",").map((p) => p.trim());
  const key: Record<string, string> = {};
  if (parts.length === 1 && !parts[0]!.includes("=")) {
    key[def.keys[0]!] = parts[0]!.replace(/^'|'$/g, "");
  } else {
    for (const part of parts) {
      const [name, raw] = part.split("=");
      key[name!.trim()] = (raw ?? "").trim().replace(/^'|'$/g, "").replaceAll("''", "'");
    }
  }
  return { set, key };
}

function keyPredicate(set: string, entity: Entity): string {
  return SETS[set]!.keys.map((k) => `${k}='${String(entity[k] ?? "")}'`).join(",");
}

export function buildMockS4(options: MockS4Options = {}): { app: FastifyInstance; store: Store } {
  const store = options.store ?? new Store();
  const app = Fastify({ logger: options.logger ?? false });
  const auth = "Basic " + Buffer.from(`${options.user ?? "BBC_CONNECTOR"}:${options.password ?? "mock"}`).toString("base64");
  const csrf = new Map<string, { session: string; expires: number }>();
  let faults: Fault[] = [];

  app.addHttpMethod("MERGE", { hasBody: true });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("Date", new Date(store.now()).toUTCString());
    if (req.url.startsWith("/__mock/")) return;
    if (req.headers.authorization !== auth) {
      reply.header("WWW-Authenticate", 'Basic realm="SAP NetWeaver Application Server"');
      return sendError(reply, new ODataError(401, "UNAUTHORIZED", "Logon failed"));
    }
    const path = req.url.split("?")[0]!;
    const fault = faults.find((f) => f.count > 0 && path.includes(f.path) && (!f.method || f.method === req.method));
    if (fault) {
      fault.count -= 1;
      return sendError(reply, new ODataError(fault.status, "MOCK_FAULT", fault.message ?? "injected fault"));
    }
    if (!path.startsWith(BASE)) return;
    if (req.method === "GET" && String(req.headers["x-csrf-token"]).toLowerCase() === "fetch") {
      const token = randomUUID().replaceAll("-", "");
      const session = randomUUID();
      csrf.set(token, { session, expires: Date.now() + CSRF_TTL_MS });
      reply.header("x-csrf-token", token);
      reply.header("set-cookie", `SAP_SESSIONID=${session}; Path=/; HttpOnly`);
    }
    if (req.method !== "GET") {
      const token = String(req.headers["x-csrf-token"] ?? "");
      const session = /SAP_SESSIONID=([^;]+)/.exec(String(req.headers.cookie ?? ""))?.[1];
      const known = csrf.get(token);
      if (!known || known.session !== session || known.expires < Date.now()) {
        return sendError(
          reply,
          new ODataError(403, "/IWFND/CM_BEC/026", "CSRF token validation failed", { "x-csrf-token": "Required" }),
        );
      }
    }
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ODataError) return sendError(reply, error);
    if (error instanceof ConflictError) return sendError(reply, new ODataError(error.status, error.code, error.message));
    if (error instanceof EdmError) return sendError(reply, new ODataError(400, "/IWBEP/CM_MGW_RT/020", error.message));
    return sendError(reply, new ODataError(500, "INTERNAL", error instanceof Error ? error.message : String(error)));
  });

  // ---------------------------------------------------------------- reads
  function entityOut(req: FastifyRequest, set: string, entity: Entity, select?: string[], expand?: string[]): Entity {
    const def = SETS[set]!;
    const uri = `http://${req.headers.host}${BASE}/${def.service}/${set}(${keyPredicate(set, entity)})`;
    const out: Entity = { __metadata: { id: uri, uri, type: def.type, etag: store.etag(set, entity) }, ...serialize(def.fields, entity, select) };
    for (const nav of expand ?? []) {
      const child = def.nav?.[nav];
      if (!child) throw new ODataError(400, "/IWBEP/CM_MGW_RT/005", `Property ${nav} not found in type ${def.type}`);
      out[nav] = { results: store.children(set, nav, entity).map((c) => entityOut(req, child, c)) };
    }
    return out;
  }

  function collection(req: FastifyRequest, set: string) {
    const q = req.query as Record<string, string | undefined>;
    const def = SETS[set]!;
    let rows = store.all(set);
    if (q.$filter) {
      const node = parseFilter(q.$filter);
      rows = rows.filter((r) => matches(node, r, def.fields));
    }
    const order = (q.$orderby ?? def.keys.join(",")).split(",").map((s) => s.trim().split(/\s+/));
    rows.sort((a, b) => {
      for (const [field, dir] of order) {
        const x = a[field!] as number | string;
        const y = b[field!] as number | string;
        if (x === y) continue;
        const cmp = x === null || x === undefined ? -1 : y === null || y === undefined ? 1 : x < y ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
      return 0;
    });
    const total = rows.length;
    const skip = Number(q.$skiptoken ?? q.$skip ?? 0);
    const top = q.$top !== undefined ? Number(q.$top) : undefined;
    const end = top !== undefined ? Math.min(skip + top, total) : total;
    const pageEnd = Math.min(end, skip + PAGE);
    const select = q.$select?.split(",").map((s) => s.trim());
    const expand = q.$expand?.split(",").map((s) => s.trim());
    const body: Record<string, unknown> = {
      results: rows.slice(skip, pageEnd).map((r) => entityOut(req, set, r, select, expand)),
    };
    if (q.$inlinecount === "allpages") body.__count = String(total);
    if (pageEnd < end) {
      const params = new URLSearchParams({ ...(q as Record<string, string>), $skiptoken: String(pageEnd) });
      params.delete("$skip");
      body.__next = `http://${req.headers.host}${BASE}/${def.service}/${set}?${params.toString()}`;
    }
    return { d: body };
  }

  function resolve(req: FastifyRequest) {
    const params = req.params as { service: string; "*": string };
    const { set, key } = parseResource(params["*"]);
    return { service: params.service, set, key };
  }

  app.get(`${BASE}/:service/*`, async (req, reply) => {
    const path = (req.params as { service: string; "*": string })["*"];
    if (path === "" || path === "$metadata") {
      const service = (req.params as { service: string }).service;
      return { d: { EntitySets: Object.keys(SETS).filter((s) => SETS[s]!.service === service) } };
    }
    const { service, set, key } = resolve(req);
    const def = SETS[set];
    if (!def || def.service !== service) throw new ODataError(404, "/IWFND/MED/170", `Resource not found for segment ${set}`);
    if (!key) return collection(req, set);
    const entity = store.get(set, key);
    if (!entity) throw new ODataError(404, "/IWBEP/CM_MGW_RT/021", `Resource not found for ${set}(${JSON.stringify(key)})`);
    reply.header("ETag", store.etag(set, entity));
    const q = req.query as Record<string, string | undefined>;
    return { d: entityOut(req, set, entity, undefined, q.$expand?.split(",")) };
  });

  // ---------------------------------------------------------------- writes
  function navResults(body: Record<string, unknown>, nav: string): Record<string, unknown>[] {
    const value = body[nav] as { results?: unknown[] } | unknown[] | undefined;
    if (!value) return [];
    return (Array.isArray(value) ? value : (value.results ?? [])) as Record<string, unknown>[];
  }

  app.post(`${BASE}/:service/*`, async (req, reply) => {
    const { service, set } = resolve(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const q = req.query as Record<string, string | undefined>;
    const unquote = (v?: string) => (v ?? "").replace(/^'|'$/g, "");

    if (service === "API_SALES_ORDER_SRV" && set === "A_SalesOrder") {
      const order = coerce(SETS.A_SalesOrder!.fields, body);
      order.SalesOrder ??= store.nextSalesOrder();
      order.TransactionCurrency ??= "USD";
      order.OverallSDProcessStatus ??= "A";
      order.SalesOrderDate ??= store.now();
      const items = navResults(body, "to_Item");
      if (!items.length) throw new ODataError(400, "V1/320", "Sales order needs at least one item");
      const saved = store.upsert("A_SalesOrder", order);
      items.forEach((raw, i) => {
        const item = coerce(SETS.A_SalesOrderItem!.fields, raw);
        store.upsert("A_SalesOrderItem", {
          SDProcessStatus: "A",
          RequestedQuantityUnit: "KG",
          NetPriceQuantity: 1,
          ...item,
          SalesOrder: saved.SalesOrder,
          SalesOrderItem: item.SalesOrderItem ?? String((i + 1) * 10),
          YY1_BBCReference: item.YY1_BBCReference ?? saved.YY1_BBCReference ?? null,
        });
      });
      return reply.code(201).send({ d: entityOut(req, "A_SalesOrder", saved, undefined, ["to_Item"]) });
    }
    if (service === "API_SALES_ORDER_SRV" && set === "RejectSalesOrder") {
      const order = store.get("A_SalesOrder", { SalesOrder: unquote(q.SalesOrder) });
      if (!order) throw new ODataError(404, "V1/302", `Sales order ${unquote(q.SalesOrder)} does not exist`);
      for (const item of store.children("A_SalesOrder", "to_Item", order)) {
        store.upsert("A_SalesOrderItem", { ...item, SalesDocumentRjcnReason: "Z1" });
      }
      const saved = store.upsert("A_SalesOrder", { ...order, OverallSDProcessStatus: "C" });
      return { d: entityOut(req, "A_SalesOrder", saved, undefined, ["to_Item"]) };
    }
    if (service === "API_OUTBOUND_DELIVERY_SRV" && set === "A_OutbDeliveryHeader") {
      const items = navResults(body, "to_DeliveryDocumentItem");
      if (!items.length) throw new ODataError(400, "VL/022", "Delivery needs at least one item");
      const header = coerce(SETS.A_OutbDeliveryHeader!.fields, body);
      const doc = store.nextDelivery();
      for (const raw of items) {
        const ref = { SalesOrder: String(raw.ReferenceSDDocument ?? ""), SalesOrderItem: String(raw.ReferenceSDDocumentItem ?? "") };
        if (!store.get("A_SalesOrderItem", ref)) {
          throw new ODataError(400, "VL/116", `Sales order item ${ref.SalesOrder}/${ref.SalesOrderItem} does not exist`);
        }
      }
      const saved = store.upsert("A_OutbDeliveryHeader", {
        OverallGoodsMovementStatus: "A",
        OverallProofOfDeliveryStatus: "",
        ...header,
        DeliveryDocument: doc,
      });
      items.forEach((raw, i) =>
        store.upsert("A_OutbDeliveryItem", {
          DeliveryQuantityUnit: "KG",
          ...coerce(SETS.A_OutbDeliveryItem!.fields, raw),
          DeliveryDocument: doc,
          DeliveryDocumentItem: String((i + 1) * 10),
        }),
      );
      return reply.code(201).send({ d: entityOut(req, "A_OutbDeliveryHeader", saved, undefined, ["to_DeliveryDocumentItem"]) });
    }
    if (service === "API_MATERIAL_DOCUMENT_SRV" && set === "A_MaterialDocumentHeader") {
      const items = navResults(body, "to_MaterialDocumentItem").map((raw) => coerce(SETS.A_MaterialDocumentItem!.fields, raw));
      if (!items.length) throw new ODataError(400, "M7/018", "Material document needs at least one item");
      const saved = store.postMaterialDocument(coerce(SETS.A_MaterialDocumentHeader!.fields, body), items);
      return reply.code(201).send({ d: entityOut(req, "A_MaterialDocumentHeader", saved, undefined, ["to_MaterialDocumentItem"]) });
    }
    if (service === "API_SUPPLIERINVOICE_PROCESS_SRV" && set === "A_SupplierInvoice") {
      const invoice = coerce(SETS.A_SupplierInvoice!.fields, body);
      if (!invoice.InvoicingParty || invoice.InvoiceGrossAmount === undefined) {
        throw new ODataError(400, "M8/001", "InvoicingParty and InvoiceGrossAmount are required");
      }
      const saved = store.upsert("A_SupplierInvoice", {
        DocumentCurrency: "USD",
        IsInvoice: true,
        DocumentDate: store.now(),
        PostingDate: store.now(),
        ...invoice,
        SupplierInvoice: store.nextInvoice(),
        FiscalYear: String(new Date(store.now()).getUTCFullYear()),
      });
      return reply.code(201).send({ d: entityOut(req, "A_SupplierInvoice", saved) });
    }
    if (service === "API_SUPPLIERINVOICE_PROCESS_SRV" && set === "Cancel") {
      const original = store.get("A_SupplierInvoice", { SupplierInvoice: unquote(q.SupplierInvoice), FiscalYear: unquote(q.FiscalYear) });
      if (!original) throw new ODataError(404, "M8/002", "Supplier invoice does not exist");
      if (original.ReverseDocument) throw new ODataError(409, "M8/107", `Document already reversed by ${String(original.ReverseDocument)}`);
      const reversal = store.upsert("A_SupplierInvoice", {
        ...original,
        SupplierInvoice: store.nextInvoice(),
        IsInvoice: !original.IsInvoice,
        DocumentHeaderText: `Reversal of ${String(original.SupplierInvoice)}`,
        ReverseDocument: original.SupplierInvoice,
      });
      store.upsert("A_SupplierInvoice", { ...original, ReverseDocument: reversal.SupplierInvoice });
      return { d: entityOut(req, "A_SupplierInvoice", reversal) };
    }
    throw new ODataError(405, "/IWBEP/CM_MGW_RT/049", `POST not supported for ${service}/${set}`);
  });

  async function update(req: FastifyRequest, reply: FastifyReply) {
    const { set, key } = resolve(req);
    if (set !== "A_SalesOrderItem" || !key) throw new ODataError(405, "/IWBEP/CM_MGW_RT/049", `Update not supported for ${set}`);
    const entity = store.get(set, key);
    if (!entity) throw new ODataError(404, "/IWBEP/CM_MGW_RT/021", "Sales order item does not exist");
    const ifMatch = req.headers["if-match"];
    if (!ifMatch) throw new ODataError(428, "/IWBEP/CM_MGW_RT/098", "If-Match header required");
    if (ifMatch !== store.etag(set, entity)) {
      throw new ODataError(412, "/IWBEP/CM_MGW_RT/022", "The entity has been changed by another user (ETag mismatch)");
    }
    const changes = coerce(SETS.A_SalesOrderItem!.fields, (req.body ?? {}) as Record<string, unknown>);
    const allowed = ["Batch", "RequestedQuantity", "RequestedDeliveryDate", "YY1_BBCReference"];
    const extra = Object.keys(changes).filter((f) => !allowed.includes(f) && !SETS[set]!.keys.includes(f));
    if (extra.length) throw new ODataError(400, "V1/351", `Fields not changeable: ${extra.join(", ")}`);
    const saved = store.upsert(set, { ...entity, ...changes });
    reply.header("ETag", store.etag(set, saved));
    return reply.code(204).send();
  }
  app.patch(`${BASE}/:service/*`, update);
  app.route({ method: "MERGE", url: `${BASE}/:service/*`, handler: update });

  app.delete(`${BASE}/:service/*`, async (req, reply) => {
    const { set, key } = resolve(req);
    if (set !== "A_OutbDeliveryHeader" || !key) throw new ODataError(405, "/IWBEP/CM_MGW_RT/049", `DELETE not supported for ${set}`);
    const header = store.get(set, key);
    if (!header) throw new ODataError(404, "VL/001", "Delivery does not exist");
    if (header.OverallGoodsMovementStatus === "C") {
      throw new ODataError(409, "VL/361", `Delivery ${String(header.DeliveryDocument)} has been goods-issued and cannot be deleted`);
    }
    for (const item of store.children(set, "to_DeliveryDocumentItem", header)) store.remove("A_OutbDeliveryItem", item);
    store.remove(set, header);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- simulator entry points
  type Records = { records: Record<string, unknown>[] };
  const records = (req: FastifyRequest) => ((req.body ?? {}) as Records).records ?? [];

  app.put("/__sim/clock", async (req) => {
    const { now } = (req.body ?? {}) as { now?: string };
    const ms = Date.parse(String(now));
    if (Number.isNaN(ms)) throw new ODataError(400, "SIM", "now must be an ISO-8601 timestamp");
    store.setClock(ms);
    return { now: new Date(store.now()).toISOString() };
  });
  app.post("/__sim/reset", async () => {
    store.reset();
    return { reset: true };
  });
  app.post("/__sim/batches", async (req) => ({
    upserted: records(req).map((r) => store.upsert("Batch", coerce(SETS.Batch!.fields, r))).length,
  }));
  app.post("/__sim/inspection-lots", async (req) => ({
    upserted: records(req).map((r) => store.upsert("A_InspectionLot", coerce(SETS.A_InspectionLot!.fields, r))).length,
  }));
  app.post("/__sim/sales-orders", async (req) => {
    for (const r of records(req)) {
      const order = store.upsert("A_SalesOrder", coerce(SETS.A_SalesOrder!.fields, r));
      for (const item of (r.items ?? []) as Record<string, unknown>[]) {
        store.upsert("A_SalesOrderItem", { ...coerce(SETS.A_SalesOrderItem!.fields, item), SalesOrder: order.SalesOrder });
      }
    }
    return { upserted: records(req).length };
  });
  app.post("/__sim/deliveries", async (req) => {
    for (const r of records(req)) {
      const header = store.upsert("A_OutbDeliveryHeader", coerce(SETS.A_OutbDeliveryHeader!.fields, r));
      for (const item of (r.items ?? []) as Record<string, unknown>[]) {
        store.upsert("A_OutbDeliveryItem", { ...coerce(SETS.A_OutbDeliveryItem!.fields, item), DeliveryDocument: header.DeliveryDocument });
      }
    }
    return { upserted: records(req).length };
  });
  app.put("/__sim/stock", async (req) => {
    for (const r of records(req)) {
      const key = coerce(SETS.A_MatlStkInAcctMod!.fields, r);
      store.setStock(key, Number(r.quantity ?? 0));
    }
    return { set: records(req).length };
  });
  app.get("/__sim/state", async () =>
    Object.fromEntries(Object.keys(SETS).map((s) => [s, store.all(s).length])),
  );

  // ---------------------------------------------------------------- failure injection
  app.post("/__mock/faults", async (req) => {
    const fault = req.body as Fault;
    faults.push({ ...fault, count: fault.count ?? 1 });
    return { faults };
  });
  app.delete("/__mock/faults", async () => {
    faults = [];
    return { faults };
  });

  return { app, store };
}
