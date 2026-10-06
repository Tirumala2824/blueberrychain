/**
 * Outbound action handlers for SAP S/4HANA (contracts/apis/mock-s4.odata.md), used by the
 * engine's dispatcher. Writes follow SAP's rules: a CSRF token and session cookie for
 * every POST / PATCH, If-Match ETags as the compare-and-set, and our idempotency
 * reference stored in a field the dispatcher can look up before it ever resends.
 * The intent payload carries SAP's keys (material, plant, storage location, batch, sales
 * order item); the gateway maps them in Snowflake, so the dispatcher holds no mapping.
 * Payload fields per action are in contracts/apis/dispatch-target-states.md.
 */

import { TargetRejectedError, type ActionHandler } from "@blueberrychain/connector-sdk";
import { ODataError, type ODataConfig } from "./odata.js";

export interface SapIntent {
  action_type: string;
  idempotency_key: string;
  target_entity: { type: string; id: string };
  payload: Record<string, unknown>;
}

type Json = Record<string, unknown>;

/** SAP text fields are short; the reference is the first 25 characters of the key. */
export const sapReference = (key: string) => key.slice(0, 25);

export class ODataWriter {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: string;
  private session: { token: string; cookie: string } | null = null;

  constructor(private readonly config: ODataConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.auth = "Basic " + Buffer.from(`${config.user}:${config.password}`).toString("base64");
  }

  private async csrf(service: string): Promise<{ token: string; cookie: string }> {
    if (this.session) return this.session;
    const r = await this.fetchImpl(`${this.config.baseUrl}/${service}/`, { headers: { Authorization: this.auth, "x-csrf-token": "Fetch", Accept: "application/json" } });
    const token = r.headers.get("x-csrf-token");
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    if (!token) throw new ODataError(r.status, `${service}: no CSRF token issued`);
    this.session = { token, cookie };
    return this.session;
  }

  async send(method: "GET" | "POST" | "PATCH", service: string, path: string, options: { body?: Json; ifMatch?: string } = {}, retried = false): Promise<{ status: number; headers: Headers; body: Json }> {
    const headers: Record<string, string> = { Authorization: this.auth, Accept: "application/json" };
    if (method !== "GET") {
      const s = await this.csrf(service);
      headers["x-csrf-token"] = s.token;
      headers["Cookie"] = s.cookie;
      headers["Content-Type"] = "application/json";
      if (options.ifMatch) headers["If-Match"] = options.ifMatch;
    }
    const r = await this.fetchImpl(`${this.config.baseUrl}/${service}/${path}`, { method, headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    if (r.status === 403 && r.headers.get("x-csrf-token")?.toLowerCase() === "required" && !retried) {
      this.session = null;
      return this.send(method, service, path, options, true);
    }
    const text = await r.text();
    let body: Json = {};
    try {
      body = text ? (JSON.parse(text) as Json) : {};
    } catch {
      body = { raw: text };
    }
    return { status: r.status, headers: r.headers, body };
  }
}

function check(r: { status: number; body: Json }, what: string): Json {
  if (r.status >= 200 && r.status < 300) return ((r.body["d"] ?? r.body) as Json) ?? {};
  const message = ((r.body["error"] as Json | undefined)?.["message"] as Json | undefined)?.["value"] ?? `HTTP ${r.status}`;
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
    throw new TargetRejectedError(r.status, `SAP_${r.status}`, `${what}: ${String(message)}`);
  }
  throw new ODataError(r.status, `${what}: ${String(message)}`);
}

const q = (v: unknown) => `'${String(v ?? "").replaceAll("'", "''")}'`;
const filter = (f: Record<string, unknown>) => encodeURIComponent(Object.entries(f).map(([k, v]) => `${k} eq ${q(v)}`).join(" and "));

export function sapHandlers(sap: ODataWriter): ActionHandler<SapIntent>[] {
  const etags = new WeakMap<SapIntent, string>();

  // ---- stock: goods movements 344 (unrestricted -> blocked) and 343 (back) ----------------
  const stockOf = async (p: Json) => {
    const key = { Material: p["material"], Plant: p["plant"], StorageLocation: p["storage_location"], Batch: p["batch"] };
    const rows = (check(await sap.send("GET", "API_MATERIAL_STOCK_SRV", `A_MatlStkInAcctMod?$filter=${filter(key)}&$format=json`), "read stock")["results"] ?? []) as Json[];
    const qty = (type: string) => rows.filter((r) => r["InventoryStockType"] === type).reduce((s, r) => s + Number(r["MatlWrhsStkQtyInMatlBaseUnit"] ?? 0), 0);
    return { unrestricted_kg: qty("01"), restricted_kg: qty("07") };
  };
  const movement = (actionType: "STOCK_BLOCK" | "STOCK_UNBLOCK"): ActionHandler<SapIntent> => ({
    actionTypes: [actionType],
    targetSystem: "SAP",
    readBefore: (intent) => stockOf(intent.payload),
    async execute(intent, key) {
      const p = intent.payload;
      const body = check(await sap.send("POST", "API_MATERIAL_DOCUMENT_SRV", "A_MaterialDocumentHeader", {
        body: {
          GoodsMovementCode: "04",
          MaterialDocumentHeaderText: sapReference(key),
          to_MaterialDocumentItem: { results: [{
            Material: p["material"], Plant: p["plant"], StorageLocation: p["storage_location"], Batch: p["batch"],
            GoodsMovementType: actionType === "STOCK_BLOCK" ? "344" : "343", QuantityInEntryUnit: String(p["kg"]), EntryUnit: "KG",
          }] },
        },
      }), actionType === "STOCK_BLOCK" ? "block stock" : "unblock stock");
      return { externalRef: `${String(body["MaterialDocument"])}/${String(body["MaterialDocumentYear"])}`, response: body };
    },
    async status(_intent, key) {
      const rows = (check(await sap.send("GET", "API_MATERIAL_DOCUMENT_SRV", `A_MaterialDocumentHeader?$filter=${filter({ MaterialDocumentHeaderText: sapReference(key) })}&$format=json`), "look up material document")["results"] ?? []) as Json[];
      const hit = rows[0];
      return hit ? { state: "APPLIED", externalRef: `${String(hit["MaterialDocument"])}/${String(hit["MaterialDocumentYear"])}` } : { state: "UNKNOWN" };
    },
    readAfter: (intent) => stockOf(intent.payload),
  });

  // ---- sales order item: PATCH with If-Match -----------------------------------------------
  const itemPath = (p: Json) => `A_SalesOrderItem(SalesOrder=${q(p["sales_order"])},SalesOrderItem=${q(p["sales_order_item"])})`;
  const readItem = async (intent: SapIntent) => {
    const r = await sap.send("GET", "API_SALES_ORDER_SRV", `${itemPath(intent.payload)}?$format=json`);
    const body = check(r, "read sales order item");
    etags.set(intent, r.headers.get("etag") ?? "");
    return {
      batch: body["Batch"] ?? null,
      requested_quantity_kg: body["RequestedQuantity"] === undefined ? null : Number(body["RequestedQuantity"]),
      requested_delivery_date: body["RequestedDeliveryDate"] ?? null,
      reference: body["YY1_BBCReference"] ?? null,
    };
  };
  const soChange = (actionType: "SO_CHANGE" | "SO_REVERT"): ActionHandler<SapIntent> => ({
    actionTypes: [actionType],
    targetSystem: "SAP",
    async readBefore(intent) {
      const { reference: _ref, ...observed } = await readItem(intent);
      return observed;
    },
    async execute(intent, key) {
      const changes = (intent.payload["changes"] ?? {}) as Json;
      const allowed: Record<string, string> = { batch: "Batch", requested_quantity_kg: "RequestedQuantity", requested_delivery_date: "RequestedDeliveryDate" };
      const body: Json = { YY1_BBCReference: sapReference(key) };
      for (const [k, v] of Object.entries(changes)) {
        if (!allowed[k]) throw new TargetRejectedError(400, "UNSUPPORTED_FIELD", `${actionType} can't change ${k}`);
        body[allowed[k]] = k === "requested_quantity_kg" ? String(v) : v;
      }
      const r = await sap.send("PATCH", "API_SALES_ORDER_SRV", itemPath(intent.payload), { body, ifMatch: etags.get(intent) ?? "" });
      check(r, `change ${String(intent.payload["sales_order"])}/${String(intent.payload["sales_order_item"])}`);
      return { externalRef: `${String(intent.payload["sales_order"])}/${String(intent.payload["sales_order_item"])}`, response: { etag: r.headers.get("etag") } };
    },
    async status(intent, key) {
      const item = await readItem(intent);
      return item.reference === sapReference(key) ? { state: "APPLIED", externalRef: `${String(intent.payload["sales_order"])}/${String(intent.payload["sales_order_item"])}` } : { state: "UNKNOWN" };
    },
    async readAfter(intent) {
      const { reference: _ref, ...observed } = await readItem(intent);
      return observed;
    },
  });

  return [movement("STOCK_BLOCK"), movement("STOCK_UNBLOCK"), soChange("SO_CHANGE"), soChange("SO_REVERT")];
}
