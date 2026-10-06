/**
 * The S/4 pull source: one cursor stream per entity.
 *
 * Delta streams read `LastChangeDateTime gt <cursor>` ordered by LastChangeDateTime,
 * a page at a time; the cursor is the last change seen, committed with the rows
 * (connector-sdk syncSource). The stock stream reads a full snapshot, stamped with
 * the server's Date header, at most once per `stockEveryMs` of server time.
 */

import type { BusinessEventRow, PullPage, PullSource } from "@blueberrychain/connector-sdk";
import { MappingError } from "./keymap.js";
import * as map from "./mapping.js";
import { datetimeoffset, isoDate, type ODataClient } from "./odata.js";

type Row = Record<string, unknown>;

export const STREAMS = ["batches", "sales_order_items", "deliveries", "inspection_lots", "stock"] as const;
export type Stream = (typeof STREAMS)[number];

const DELTA: Record<Exclude<Stream, "stock">, { service: string; set: string; expand?: string }> = {
  batches: { service: "API_BATCH_SRV", set: "Batch" },
  sales_order_items: { service: "API_SALES_ORDER_SRV", set: "A_SalesOrderItem" },
  deliveries: { service: "API_OUTBOUND_DELIVERY_SRV", set: "A_OutbDeliveryHeader", expand: "to_DeliveryDocumentItem" },
  inspection_lots: { service: "API_INSPECTIONLOT_SRV", set: "A_InspectionLot" },
};

export interface SapSourceOptions {
  pageSize?: number;
  stockEveryMs?: number;
  onSkip?: (stream: Stream, reason: string, record: Row) => void;
}

export class SapS4Source implements PullSource<BusinessEventRow> {
  readonly target = "BUSINESS_EVENTS" as const;
  readonly streams = STREAMS;
  readonly skipped: Array<{ stream: Stream; reason: string }> = [];
  private readonly pageSize: number;
  private readonly stockEveryMs: number;
  private readonly orderHeaders = new Map<string, Row>();

  constructor(
    private readonly client: ODataClient,
    private readonly ctx: map.MapContext,
    private readonly options: SapSourceOptions = {},
  ) {
    this.pageSize = options.pageSize ?? 200;
    this.stockEveryMs = options.stockEveryMs ?? 15 * 60 * 1000;
  }

  async pull(stream: string, cursor: string | null): Promise<PullPage<BusinessEventRow>> {
    if (stream === "stock") return this.stock(cursor);
    const def = DELTA[stream as Exclude<Stream, "stock">];
    if (!def) throw new Error(`unknown stream ${stream}`);
    const query: Record<string, string> = {
      $orderby: "LastChangeDateTime",
      $top: String(this.pageSize),
      ...(cursor ? { $filter: `LastChangeDateTime gt ${datetimeoffset(cursor)}` } : {}),
      ...(def.expand ? { $expand: def.expand } : {}),
    };
    const { rows } = await this.client.getAll(def.service, def.set, query);
    if (stream === "sales_order_items") await this.loadHeaders(rows);
    const out: BusinessEventRow[] = [];
    for (const row of rows) out.push(...this.convert(stream as Stream, row));
    const last = rows.at(-1);
    return {
      rows: out,
      cursor: last ? isoDate(last.LastChangeDateTime) : cursor,
      more: rows.length === this.pageSize,
    };
  }

  private convert(stream: Stream, row: Row): BusinessEventRow[] {
    try {
      switch (stream) {
        case "batches":
          return this.keep(stream, row, map.lot(this.ctx, row), "no harvest data");
        case "sales_order_items":
          return [map.salesOrderItem(this.ctx, row, this.orderHeaders.get(String(row.SalesOrder)))];
        case "deliveries":
          return map.deliveryItems(this.ctx, row);
        case "inspection_lots":
          return this.keep(stream, row, map.inspection(this.ctx, row), "no usage decision yet");
        default:
          return [];
      }
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      this.skip(stream, error.message, row);
      return [];
    }
  }

  private keep(stream: Stream, row: Row, value: BusinessEventRow | null, reason: string): BusinessEventRow[] {
    if (value) return [value];
    this.skip(stream, reason, row);
    return [];
  }

  private skip(stream: Stream, reason: string, row: Row) {
    this.skipped.push({ stream, reason });
    this.options.onSkip?.(stream, reason, row);
  }

  /**
   * Items carry no sold-to party; read each new order's header once (the contract's
   * $filter has no `or`, so one request per order, cached for the life of the source).
   */
  private async loadHeaders(items: Row[]) {
    const missing = [...new Set(items.map((i) => String(i.SalesOrder)))].filter((so) => !this.orderHeaders.has(so));
    for (const so of missing) {
      const { rows } = await this.client.getAll("API_SALES_ORDER_SRV", "A_SalesOrder", {
        $filter: `SalesOrder eq '${so.replaceAll("'", "''")}'`,
        $select: "SalesOrder,SoldToParty",
      });
      for (const header of rows) this.orderHeaders.set(String(header.SalesOrder), header);
    }
  }

  private async stock(cursor: string | null): Promise<PullPage<BusinessEventRow>> {
    const { rows, serverTime } = await this.client.getAll("API_MATERIAL_STOCK_SRV", "A_MatlStkInAcctMod", {});
    if (cursor && serverTime.getTime() - Date.parse(cursor) < this.stockEveryMs) {
      return { rows: [], cursor, more: false };
    }
    const snapshotAt = serverTime.toISOString();
    const out: BusinessEventRow[] = [];
    for (const row of rows) {
      try {
        const value = map.stock(this.ctx, row, snapshotAt);
        if (value) out.push(value);
      } catch (error) {
        if (!(error instanceof MappingError)) throw error;
        this.skip("stock", error.message, row);
      }
    }
    return { rows: out, cursor: snapshotAt, more: false };
  }
}
