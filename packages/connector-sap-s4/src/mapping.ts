/**
 * S/4 entities -> RAW.BUSINESS_EVENTS rows (contracts/apis/mock-s4.odata.md "Mapping to RAW").
 * Each function returns null for records that are not facts yet (e.g. an inspection lot
 * without a usage decision); unmapped SAP keys raise MappingError.
 */

import { type BusinessEventRow, businessEventRow, type Provenance } from "@blueberrychain/connector-sdk";
import { type KeyMap, mapKey, siteOf } from "./keymap.js";
import { decimal, isoDate } from "./odata.js";

type Row = Record<string, unknown>;

export interface MapContext {
  connectorId: string;
  keys: KeyMap;
  provenance?: Provenance;
}

function event(ctx: MapContext, entityType: BusinessEventRow["entity_type"], externalId: string, eventTs: string, payload: Row) {
  return businessEventRow({
    connectorId: ctx.connectorId,
    sourceSystem: "SAP",
    entityType,
    externalId,
    eventTs,
    payload,
    ...(ctx.provenance ? { provenance: ctx.provenance } : {}),
  });
}

/** Drop absent optional fields: payload contracts forbid explicit nulls where a field is not nullable. */
function compact(payload: Row): Row {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

export function lot(ctx: MapContext, b: Row): BusinessEventRow | null {
  const harvestAt = isoDate(b.YY1_HarvestDateTime);
  if (!harvestAt) return null; // not a harvest lot (e.g. a purchased batch without field data)
  return event(ctx, "LOT", String(b.Batch), isoDate(b.LastChangeDateTime)!, compact({
    lot_id: b.Batch,
    product_id: mapKey(ctx.keys, "material", b.Material),
    grower_party_id: mapKey(ctx.keys, "business_partner", b.Supplier),
    harvest_site_id: mapKey(ctx.keys, "harvest_block", b.YY1_HarvestBlock),
    packhouse_site_id: b.BatchIdentifyingPlant ? mapKey(ctx.keys, "plant", b.BatchIdentifyingPlant) : null,
    harvest_at: harvestAt,
    packed_at: isoDate(b.YY1_PackedDateTime),
    kg: decimal(b.YY1_NetWeightKg),
    organic: b.YY1_Organic === "X",
  }));
}

/** SAP item state -> our order-line status. */
export function orderLineStatus(item: Row): string {
  if (item.SalesDocumentRjcnReason) return "CANCELLED";
  if (item.SDProcessStatus === "C") return "DELIVERED";
  if (item.SDProcessStatus === "B") return "SHIPPED";
  return item.Batch ? "ALLOCATED" : "OPEN";
}

export function salesOrderItem(ctx: MapContext, item: Row, header: Row | undefined): BusinessEventRow {
  const id = `SO-${String(item.SalesOrder)}-${String(item.SalesOrderItem)}`;
  const changed = isoDate(item.LastChangeDateTime)!;
  const soldTo = header?.SoldToParty;
  return event(ctx, "SALES_ORDER_ITEM", id, changed, compact({
    order_line_id: id,
    sales_order: item.SalesOrder,
    item: item.SalesOrderItem,
    customer_party_id: mapKey(ctx.keys, "business_partner", soldTo),
    product_id: mapKey(ctx.keys, "material", item.Material),
    kg: decimal(item.RequestedQuantity),
    price_usd_per_kg: decimal(item.NetPriceAmount),
    requested_delivery_at: isoDate(item.RequestedDeliveryDate),
    ship_to_site_id: mapKey(ctx.keys, "ship_to", item.ShipToParty),
    status: orderLineStatus(item),
    assigned_lot_id: item.Batch || null,
    last_change_at: changed,
  }));
}

export function deliveryStatus(header: Row): string {
  if (header.OverallProofOfDeliveryStatus === "C") return "DELIVERED";
  if (header.OverallGoodsMovementStatus === "C") return "GOODS_ISSUED";
  if (header.OverallGoodsMovementStatus === "B") return "PICKED";
  return "CREATED";
}

export function deliveryItems(ctx: MapContext, header: Row): BusinessEventRow[] {
  const changed = isoDate(header.LastChangeDateTime)!;
  const items = ((header.to_DeliveryDocumentItem as { results?: Row[] } | undefined)?.results ?? []) as Row[];
  return items
    .filter((item) => item.Batch)
    .map((item) => {
      const id = `DLV-${String(item.DeliveryDocument)}-${String(item.DeliveryDocumentItem)}`;
      return event(ctx, "DELIVERY", id, changed, compact({
        delivery_id: id,
        order_line_id: `SO-${String(item.ReferenceSDDocument)}-${String(item.ReferenceSDDocumentItem)}`,
        lot_id: item.Batch,
        shipment_id: header.YY1_TMSShipment || null,
        kg: decimal(item.ActualDeliveryQuantity),
        planned_goods_issue_at: isoDate(header.PlannedGoodsIssueDate),
        status: deliveryStatus(header),
        last_change_at: changed,
      }));
    });
}

const INSPECTION_TYPES: Record<string, string> = { "01": "RECEIPT", "04": "INTERMEDIATE", "89": "ORIGIN" };

export function inspection(ctx: MapContext, lotRow: Row): BusinessEventRow | null {
  const decision = lotRow.InspectionLotUsageDecisionCode;
  if (decision !== "A" && decision !== "R") return null; // no usage decision yet: not a result
  const type = INSPECTION_TYPES[String(lotRow.InspectionLotType)];
  if (!type) return null;
  const inspectedAt = isoDate(lotRow.YY1_InspectedAt) ?? isoDate(lotRow.InspLotCreatedOnLocalDate)!;
  return event(ctx, "INSPECTION_RESULT", `QC-${String(lotRow.InspectionLot)}`, isoDate(lotRow.LastChangeDateTime)!, compact({
    inspection_id: `QC-${String(lotRow.InspectionLot)}`,
    lot_id: lotRow.Batch,
    site_id: siteOf(ctx.keys, lotRow.Plant, lotRow.YY1_ShipToParty),
    inspection_type: type,
    inspected_at: inspectedAt,
    pulp_c: decimal(lotRow.YY1_PulpTempC),
    defects_pct: decimal(lotRow.YY1_DefectsPct),
    decay_pct: decimal(lotRow.YY1_DecayPct),
    remaining_shelf_life_days_observed: decimal(lotRow.YY1_RemainingSLDays),
    accepted: decision === "A",
    inspector: lotRow.YY1_InspectorName || null,
  }));
}

const STOCK_TYPES: Record<string, string> = { "01": "UNRESTRICTED", "02": "QUALITY", "07": "BLOCKED", "06": "IN_TRANSIT" };

export function stock(ctx: MapContext, row: Row, snapshotAt: string): BusinessEventRow | null {
  const status = STOCK_TYPES[String(row.InventoryStockType)];
  if (!status || !row.Batch) return null;
  const ms = Date.parse(snapshotAt);
  const id = `STK-${String(row.Plant)}-${String(row.Batch)}-${String(row.InventoryStockType)}-${ms}`;
  return event(ctx, "STOCK_SNAPSHOT", id, snapshotAt, {
    site_id: mapKey(ctx.keys, "plant", row.Plant),
    lot_id: row.Batch,
    product_id: mapKey(ctx.keys, "material", row.Material),
    kg: decimal(row.MatlWrhsStkQtyInMatlBaseUnit),
    stock_status: status,
    snapshot_at: snapshotAt,
  });
}
