/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * One customer order line (SAP A_SalesOrderItem, mapped). Source: SAP.
 */
export interface SalesOrderItem {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  order_line_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  sales_order: string;
  item: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  customer_party_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  product_id: string;
  /**
   * Kilograms, 3-decimal precision.
   */
  kg: number;
  /**
   * US dollars per kg, 4-decimal precision.
   */
  price_usd_per_kg: number;
  requested_delivery_at: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  ship_to_site_id: string;
  status: "OPEN" | "ALLOCATED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "SHORTED";
  assigned_lot_id?: string | null;
  last_change_at: string;
}
