/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Price per kg by sales channel (contract prices live on customer contracts).
 */
export interface ReferenceChannelPrice {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  product_id: string;
  channel: "CONTRACT" | "REGIONAL" | "FOODSERVICE" | "PROCESSOR" | "DONATION";
  /**
   * US dollars per kg, 4-decimal precision.
   */
  price_usd_per_kg: number;
  effective_from: string;
}
