/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Delivery / lot assignment for an order line (SAP A_OutbDeliveryItem, mapped). Source: SAP.
 */
export interface OutboundDelivery {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  delivery_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  order_line_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  shipment_id?: string | null;
  /**
   * Kilograms, 3-decimal precision.
   */
  kg: number;
  planned_goods_issue_at?: string | null;
  status: "CREATED" | "PICKED" | "GOODS_ISSUED" | "DELIVERED" | "CANCELLED";
  last_change_at: string;
}
