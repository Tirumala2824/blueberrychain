/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * What a customer requires at receipt for a product.
 */
export interface ReferenceCustomerSpec {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  customer_party_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  product_id: string;
  min_shelf_life_days_at_receipt: number;
  max_arrival_pulp_c: number | null;
  organic_required: boolean;
}
