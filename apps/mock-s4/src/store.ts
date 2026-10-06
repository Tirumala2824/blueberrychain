/**
 * In-memory S/4 state: the entity sets of contracts/apis/mock-s4.odata.md, a simulated
 * clock, and the business rules a real system would enforce on our writes (stock
 * cannot go negative, goods-issued deliveries cannot be deleted, ...).
 */

import { type Entity, EdmError, type Fields } from "./edm.js";

export interface SetDef {
  service: string;
  name: string;
  type: string;
  keys: string[];
  fields: Fields;
  /** Navigation property -> child set (children share the parent's key fields). */
  nav?: Record<string, string>;
}

const S = "String" as const;
const D = "Decimal" as const;
const DT = "DateTime" as const;
const DTO = "DateTimeOffset" as const;

export const SETS: Record<string, SetDef> = {
  A_SalesOrder: {
    service: "API_SALES_ORDER_SRV",
    name: "A_SalesOrder",
    type: "API_SALES_ORDER_SRV.A_SalesOrderType",
    keys: ["SalesOrder"],
    fields: {
      SalesOrder: S, SoldToParty: S, SalesOrderDate: DT, TransactionCurrency: S, OverallSDProcessStatus: S,
      PurchaseOrderByCustomer: S, YY1_BBCReference: S, LastChangeDateTime: DTO,
    },
    nav: { to_Item: "A_SalesOrderItem" },
  },
  A_SalesOrderItem: {
    service: "API_SALES_ORDER_SRV",
    name: "A_SalesOrderItem",
    type: "API_SALES_ORDER_SRV.A_SalesOrderItemType",
    keys: ["SalesOrder", "SalesOrderItem"],
    fields: {
      SalesOrder: S, SalesOrderItem: S, Material: S, RequestedQuantity: D, RequestedQuantityUnit: S,
      NetPriceAmount: D, NetPriceQuantity: D, Batch: S, ShipToParty: S, RequestedDeliveryDate: DT,
      SDProcessStatus: S, SalesDocumentRjcnReason: S, YY1_BBCReference: S, LastChangeDateTime: DTO,
    },
  },
  A_OutbDeliveryHeader: {
    service: "API_OUTBOUND_DELIVERY_SRV",
    name: "A_OutbDeliveryHeader",
    type: "API_OUTBOUND_DELIVERY_SRV.A_OutbDeliveryHeaderType",
    keys: ["DeliveryDocument"],
    fields: {
      DeliveryDocument: S, ShipToParty: S, PlannedGoodsIssueDate: DT, OverallGoodsMovementStatus: S,
      OverallProofOfDeliveryStatus: S, YY1_TMSShipment: S, YY1_BBCReference: S, LastChangeDateTime: DTO,
    },
    nav: { to_DeliveryDocumentItem: "A_OutbDeliveryItem" },
  },
  A_OutbDeliveryItem: {
    service: "API_OUTBOUND_DELIVERY_SRV",
    name: "A_OutbDeliveryItem",
    type: "API_OUTBOUND_DELIVERY_SRV.A_OutbDeliveryItemType",
    keys: ["DeliveryDocument", "DeliveryDocumentItem"],
    fields: {
      DeliveryDocument: S, DeliveryDocumentItem: S, ReferenceSDDocument: S, ReferenceSDDocumentItem: S,
      Material: S, Batch: S, ActualDeliveryQuantity: D, DeliveryQuantityUnit: S,
    },
  },
  A_MatlStkInAcctMod: {
    service: "API_MATERIAL_STOCK_SRV",
    name: "A_MatlStkInAcctMod",
    type: "API_MATERIAL_STOCK_SRV.A_MatlStkInAcctModType",
    keys: ["Material", "Plant", "StorageLocation", "Batch", "InventoryStockType"],
    fields: {
      Material: S, Plant: S, StorageLocation: S, Batch: S, InventoryStockType: S,
      MatlWrhsStkQtyInMatlBaseUnit: D, MaterialBaseUnit: S,
    },
  },
  A_InspectionLot: {
    service: "API_INSPECTIONLOT_SRV",
    name: "A_InspectionLot",
    type: "API_INSPECTIONLOT_SRV.A_InspectionLotType",
    keys: ["InspectionLot"],
    fields: {
      InspectionLot: S, Material: S, Batch: S, Plant: S, InspectionLotType: S, InspLotCreatedOnLocalDate: DT,
      InspectionLotUsageDecisionCode: S, YY1_InspectedAt: DTO, YY1_ShipToParty: S, YY1_PulpTempC: D,
      YY1_DefectsPct: D, YY1_DecayPct: D, YY1_RemainingSLDays: D, YY1_InspectorName: S, LastChangeDateTime: DTO,
    },
  },
  Batch: {
    service: "API_BATCH_SRV",
    name: "Batch",
    type: "API_BATCH_SRV.BatchType",
    keys: ["Material", "BatchIdentifyingPlant", "Batch"],
    fields: {
      Material: S, BatchIdentifyingPlant: S, Batch: S, Supplier: S, ManufactureDate: DT, YY1_HarvestBlock: S,
      YY1_HarvestDateTime: DTO, YY1_PackedDateTime: DTO, YY1_NetWeightKg: D, YY1_Organic: S, LastChangeDateTime: DTO,
    },
  },
  A_MaterialDocumentHeader: {
    service: "API_MATERIAL_DOCUMENT_SRV",
    name: "A_MaterialDocumentHeader",
    type: "API_MATERIAL_DOCUMENT_SRV.A_MaterialDocumentHeaderType",
    keys: ["MaterialDocument", "MaterialDocumentYear"],
    fields: {
      MaterialDocument: S, MaterialDocumentYear: S, PostingDate: DT, GoodsMovementCode: S,
      MaterialDocumentHeaderText: S, CreationDateTime: DTO,
    },
    nav: { to_MaterialDocumentItem: "A_MaterialDocumentItem" },
  },
  A_MaterialDocumentItem: {
    service: "API_MATERIAL_DOCUMENT_SRV",
    name: "A_MaterialDocumentItem",
    type: "API_MATERIAL_DOCUMENT_SRV.A_MaterialDocumentItemType",
    keys: ["MaterialDocument", "MaterialDocumentYear", "MaterialDocumentItem"],
    fields: {
      MaterialDocument: S, MaterialDocumentYear: S, MaterialDocumentItem: S, Material: S, Plant: S,
      StorageLocation: S, Batch: S, GoodsMovementType: S, QuantityInEntryUnit: D, EntryUnit: S,
    },
  },
  A_SupplierInvoice: {
    service: "API_SUPPLIERINVOICE_PROCESS_SRV",
    name: "A_SupplierInvoice",
    type: "API_SUPPLIERINVOICE_PROCESS_SRV.A_SupplierInvoiceType",
    keys: ["SupplierInvoice", "FiscalYear"],
    fields: {
      SupplierInvoice: S, FiscalYear: S, InvoicingParty: S, DocumentDate: DT, PostingDate: DT, InvoiceGrossAmount: D,
      DocumentCurrency: S, IsInvoice: "Boolean", SupplierInvoiceIDByInvcgParty: S, DocumentHeaderText: S,
      YY1_CaseId: S, ReverseDocument: S, LastChangeDateTime: DTO,
    },
  },
};

/** Goods movement types the mock books (contract: 344 / 343). */
const MOVEMENTS: Record<string, { from: string; to: string }> = {
  "344": { from: "01", to: "07" }, // unrestricted -> blocked (STOCK_BLOCK)
  "343": { from: "07", to: "01" }, // blocked -> unrestricted (STOCK_UNBLOCK)
};

export class ConflictError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class Store {
  private readonly data = new Map<string, Map<string, Entity>>();
  private simNow: number | null = null;
  private lastChange = 0;
  private counters = { delivery: 80000000, matdoc: 4900000000, invoice: 5105600000, order: 7000 };

  constructor() {
    for (const name of Object.keys(SETS)) this.data.set(name, new Map());
  }

  // ------------------------------------------------------------------ clock
  now(): number {
    return this.simNow ?? Date.now();
  }

  setClock(ms: number): void {
    this.simNow = ms;
  }

  /** A change timestamp that is never repeated, so delta cursors cannot skip a record. */
  private touch(): number {
    this.lastChange = Math.max(this.now(), this.lastChange + 1);
    return this.lastChange;
  }

  reset(): void {
    for (const set of this.data.values()) set.clear();
    this.simNow = null;
    this.lastChange = 0;
    this.counters = { delivery: 80000000, matdoc: 4900000000, invoice: 5105600000, order: 7000 };
  }

  // ------------------------------------------------------------------ generic access
  keyOf(set: string, entity: Entity): string {
    return SETS[set]!.keys.map((k) => String(entity[k] ?? "")).join("|");
  }

  all(set: string): Entity[] {
    return [...this.data.get(set)!.values()];
  }

  get(set: string, key: Record<string, string>): Entity | undefined {
    return this.data.get(set)!.get(SETS[set]!.keys.map((k) => key[k] ?? "").join("|"));
  }

  children(parentSet: string, nav: string, parent: Entity): Entity[] {
    const childSet = SETS[parentSet]!.nav![nav]!;
    const shared = SETS[parentSet]!.keys;
    return this.all(childSet).filter((c) => shared.every((k) => c[k] === parent[k]));
  }

  etag(set: string, entity: Entity): string {
    return `W/"${String(entity.LastChangeDateTime ?? entity.__rev ?? 0)}"`;
  }

  /** Insert or merge by key; stamps LastChangeDateTime where the set has one. */
  upsert(set: string, values: Entity): Entity {
    const def = SETS[set]!;
    const key = this.keyOf(set, values);
    if (def.keys.some((k) => values[k] === undefined || values[k] === null || values[k] === "")) {
      throw new EdmError(`${set}: key fields ${def.keys.join(", ")} are required`);
    }
    const table = this.data.get(set)!;
    const merged: Entity = { ...(table.get(key) ?? {}), ...values };
    if ("LastChangeDateTime" in def.fields) merged.LastChangeDateTime = this.touch();
    merged.__rev = ((table.get(key)?.__rev as number | undefined) ?? 0) + 1;
    table.set(key, merged);
    return merged;
  }

  remove(set: string, entity: Entity): void {
    this.data.get(set)!.delete(this.keyOf(set, entity));
  }

  // ------------------------------------------------------------------ business rules
  nextSalesOrder(): string {
    const used = this.all("A_SalesOrder").map((o) => Number(o.SalesOrder)).filter(Number.isFinite);
    this.counters.order = Math.max(this.counters.order, ...used) + 1;
    return String(this.counters.order);
  }

  nextDelivery(): string {
    return String(++this.counters.delivery);
  }

  nextInvoice(): string {
    return String(++this.counters.invoice);
  }

  /** Post a goods movement: stock moves between stock types, never below zero. */
  postMaterialDocument(header: Entity, items: Entity[]): Entity {
    for (const item of items) {
      const move = MOVEMENTS[String(item.GoodsMovementType)];
      if (!move) throw new ConflictError(400, "M7/001", `movement type ${String(item.GoodsMovementType)} not supported`);
      const from = this.stockRow(item, move.from);
      const qty = Number(item.QuantityInEntryUnit);
      if (!from || Number(from.MatlWrhsStkQtyInMatlBaseUnit) < qty - 1e-9) {
        throw new ConflictError(
          400,
          "M7/021",
          `deficit of stock type ${move.from} for batch ${String(item.Batch)}: ${qty} KG requested`,
        );
      }
    }
    const year = String(new Date(this.now()).getUTCFullYear());
    const doc = String(++this.counters.matdoc);
    const saved = this.upsert("A_MaterialDocumentHeader", {
      ...header,
      MaterialDocument: doc,
      MaterialDocumentYear: year,
      PostingDate: header.PostingDate ?? this.now(),
      CreationDateTime: this.now(),
    });
    items.forEach((item, i) => {
      const move = MOVEMENTS[String(item.GoodsMovementType)]!;
      const qty = Number(item.QuantityInEntryUnit);
      this.adjustStock(item, move.from, -qty);
      this.adjustStock(item, move.to, qty);
      this.upsert("A_MaterialDocumentItem", {
        ...item,
        MaterialDocument: doc,
        MaterialDocumentYear: year,
        MaterialDocumentItem: String(i + 1),
      });
    });
    return saved;
  }

  private stockRow(item: Entity, stockType: string): Entity | undefined {
    return this.get("A_MatlStkInAcctMod", {
      Material: String(item.Material),
      Plant: String(item.Plant),
      StorageLocation: String(item.StorageLocation),
      Batch: String(item.Batch),
      InventoryStockType: stockType,
    });
  }

  adjustStock(item: Entity, stockType: string, delta: number): void {
    const row = this.stockRow(item, stockType);
    const qty = Number(row?.MatlWrhsStkQtyInMatlBaseUnit ?? 0) + delta;
    this.setStock(
      { Material: item.Material, Plant: item.Plant, StorageLocation: item.StorageLocation, Batch: item.Batch, InventoryStockType: stockType },
      qty,
    );
  }

  /**
   * Set a stock quantity. Rows that reach zero stay (as SAP's batch stock records do), so a
   * snapshot reports a sold-out lot as 0 instead of silently omitting it.
   */
  setStock(key: Entity, qty: number): void {
    const known = this.get("A_MatlStkInAcctMod", key as Record<string, string>);
    if (qty <= 1e-9 && !known) return; // never create an empty record
    this.upsert("A_MatlStkInAcctMod", { ...key, MatlWrhsStkQtyInMatlBaseUnit: Math.max(qty, 0), MaterialBaseUnit: "KG" });
  }
}
