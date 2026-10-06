/**
 * Outbound action handlers for SAP S/4HANA (contracts/apis/mock-s4.odata.md), used by the
 * engine's dispatcher. Writes follow SAP's rules: a CSRF token and session cookie for
 * every POST / PATCH, If-Match ETags as the compare-and-set, and our idempotency
 * reference stored in a field the dispatcher can look up before it ever resends.
 *
 * The gateway's intents use BlueberryChain ids (lot, site, order line). The handlers map
 * them back to SAP keys with the ingest connector's own identities: the batch is the lot
 * id, plants come from the same key map (keymap.ts), and an order line is
 * `SO-<SalesOrder>-<SalesOrderItem>` (mapping.ts). What each handler reports is named after
 * the gateway's expectations. Payloads and observations: contracts/apis/dispatch-target-states.md.
 */

import { TargetRejectedError, type ActionHandler } from "@blueberrychain/connector-sdk";
import type { KeyMap } from "./keymap.js";
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

/** The intent can't be carried out as composed (nothing is written; the dispatcher reports it). */
const incomplete = (message: string) => new TargetRejectedError(0, "INTENT_INCOMPLETE", message);

/** `SO-<SalesOrder>-<SalesOrderItem>`, the order line id the ingest connector assigns. */
export function salesOrderItemOf(orderLineId: unknown): { salesOrder: string; item: string } {
  const m = /^SO-(.+)-([^-]+)$/.exec(String(orderLineId ?? ""));
  if (!m) throw incomplete(`${String(orderLineId)} is not an SAP order line id`);
  return { salesOrder: m[1]!, item: m[2]! };
}

/** BlueberryChain site -> SAP plant (the inverse of the ingest key map). */
export function plantOf(keys: KeyMap, siteId: unknown): string {
  const hit = Object.entries(keys.plant).find(([, site]) => site === siteId);
  if (!hit) throw incomplete(`no SAP plant maps to ${String(siteId)}`);
  return hit[0];
}

const restored = (p: Json, field: string): unknown => {
  const r = p["restore"] as Json | undefined;
  if (!r || !(field in r)) throw incomplete(`the compensation carries no restore.${field}`);
  return r[field];
};

export function sapHandlers(sap: ODataWriter, keys: KeyMap): ActionHandler<SapIntent>[] {
  const etags = new WeakMap<SapIntent, string>();
  const locations = new WeakMap<SapIntent, { material: string; storageLocation: string }>();

  // ---- stock: goods movements 344 (unrestricted -> blocked) and 343 (back) ----------------
  // Payload {lot_id, site_id, kg}; observed {blocked, unrestricted_kg, blocked_kg} for the batch at the plant.
  const stockOf = async (intent: SapIntent, from: "01" | "07") => {
    const p = intent.payload;
    const key = { Plant: plantOf(keys, p["site_id"]), Batch: p["lot_id"] };
    const rows = (check(await sap.send("GET", "API_MATERIAL_STOCK_SRV", `A_MatlStkInAcctMod?$filter=${filter(key)}&$format=json`), "read stock")["results"] ?? []) as Json[];
    const qty = (type: string) => rows.filter((r) => r["InventoryStockType"] === type).reduce((s, r) => s + Number(r["MatlWrhsStkQtyInMatlBaseUnit"] ?? 0), 0);
    const source = rows.find((r) => r["InventoryStockType"] === from) ?? rows[0];
    if (source) locations.set(intent, { material: String(source["Material"]), storageLocation: String(source["StorageLocation"]) });
    const blockedKg = qty("07");
    return { blocked: blockedKg > 0, unrestricted_kg: qty("01"), blocked_kg: blockedKg };
  };
  const movement = (actionType: "STOCK_BLOCK" | "STOCK_UNBLOCK"): ActionHandler<SapIntent> => {
    const from = actionType === "STOCK_BLOCK" ? "01" : "07";
    return {
      actionTypes: [actionType],
      targetSystem: "SAP",
      readBefore: (intent) => stockOf(intent, from),
      async execute(intent, key) {
        const p = intent.payload;
        if (!locations.has(intent)) await stockOf(intent, from);
        const at = locations.get(intent);
        if (!at) throw incomplete(`batch ${String(p["lot_id"])} has no stock at ${String(p["site_id"])}`);
        const body = check(await sap.send("POST", "API_MATERIAL_DOCUMENT_SRV", "A_MaterialDocumentHeader", {
          body: {
            GoodsMovementCode: "04",
            MaterialDocumentHeaderText: sapReference(key),
            to_MaterialDocumentItem: { results: [{
              Material: at.material, Plant: plantOf(keys, p["site_id"]), StorageLocation: at.storageLocation, Batch: p["lot_id"],
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
      readAfter: (intent) => stockOf(intent, from),
    };
  };

  // ---- sales order item: PATCH with If-Match -----------------------------------------------
  // Payload carries order_line_id; observed {kg, assigned_lot_id, requested_delivery_date}.
  const itemOf = (intent: SapIntent) => salesOrderItemOf(intent.payload["order_line_id"] ?? intent.target_entity.id);
  const ref = (intent: SapIntent) => {
    const { salesOrder, item } = itemOf(intent);
    return `${salesOrder}/${item}`;
  };
  const itemPath = (intent: SapIntent) => {
    const { salesOrder, item } = itemOf(intent);
    return `A_SalesOrderItem(SalesOrder=${q(salesOrder)},SalesOrderItem=${q(item)})`;
  };
  const readItem = async (intent: SapIntent) => {
    const r = await sap.send("GET", "API_SALES_ORDER_SRV", `${itemPath(intent)}?$format=json`);
    const body = check(r, "read sales order item");
    etags.set(intent, r.headers.get("etag") ?? "");
    return {
      observed: {
        kg: body["RequestedQuantity"] === undefined ? null : Number(body["RequestedQuantity"]),
        assigned_lot_id: body["Batch"] ? String(body["Batch"]) : null,
        requested_delivery_date: body["RequestedDeliveryDate"] ?? null,
      },
      reference: body["YY1_BBCReference"] ?? null,
    };
  };
  /** What each action writes to the item (SAP field names). */
  const CHANGES = {
    SO_CHANGE: (p: Json): Json => ({ RequestedQuantity: String(p["kg"]) }),
    SO_REVERT: (p: Json): Json => ({ RequestedQuantity: String(restored(p, "kg")) }),
    REPLACEMENT_ALLOCATION: (p: Json): Json => ({ Batch: String(p["replacement_lot_id"]) }),
    DEALLOCATE: (p: Json): Json => ({ Batch: String(restored(p, "assigned_lot_id") ?? "") }),
  };
  const soItem = (actionType: keyof typeof CHANGES): ActionHandler<SapIntent> => ({
    actionTypes: [actionType],
    targetSystem: "SAP",
    readBefore: async (intent) => (await readItem(intent)).observed,
    async execute(intent, key) {
      const body: Json = { ...CHANGES[actionType](intent.payload), YY1_BBCReference: sapReference(key) };
      if (!etags.has(intent)) await readItem(intent);
      const r = await sap.send("PATCH", "API_SALES_ORDER_SRV", itemPath(intent), { body, ifMatch: etags.get(intent) ?? "" });
      check(r, `${actionType} ${ref(intent)}`);
      return { externalRef: ref(intent), response: { etag: r.headers.get("etag") } };
    },
    async status(intent, key) {
      const item = await readItem(intent);
      return item.reference === sapReference(key) ? { state: "APPLIED", externalRef: ref(intent) } : { state: "UNKNOWN" };
    },
    readAfter: async (intent) => (await readItem(intent)).observed,
  });

  return [
    movement("STOCK_BLOCK"), movement("STOCK_UNBLOCK"),
    soItem("SO_CHANGE"), soItem("SO_REVERT"), soItem("REPLACEMENT_ALLOCATION"), soItem("DEALLOCATE"),
  ];
}
