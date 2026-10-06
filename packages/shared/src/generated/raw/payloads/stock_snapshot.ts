/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Stock by plant / batch / status at a point in time (SAP material stock, mapped). Source: SAP.
 */
export interface StockSnapshot {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  site_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  product_id: string;
  /**
   * Kilograms, 3-decimal precision.
   */
  kg: number;
  stock_status: "UNRESTRICTED" | "ALLOCATED" | "BLOCKED" | "QUALITY" | "IN_TRANSIT";
  snapshot_at: string;
}
