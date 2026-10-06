/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A sellable product with its shelf-life model parameters (versioned; decisions record the version they used).
 */
export interface ReferenceProduct {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  product_id: string;
  variety: string;
  pack: string;
  organic: boolean;
  sap_material?: string | null;
  ref_shelf_life_days: number;
  tref_c: number;
  q10: number;
  threshold_c: number;
  tolerance_min: number;
  unmonitored_assumed_temp_c: number;
  validity_min_temp_c: number;
  validity_max_temp_c: number;
  prior_sigma_days: number;
  kg_per_pallet?: number | null;
}
