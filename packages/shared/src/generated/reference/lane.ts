/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A site-to-site lane with transit-time distribution and cost.
 */
export interface ReferenceLane {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lane_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  origin_site_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  dest_site_id: string;
  mode: "REEFER_TRUCK";
  transit_h_p50: number;
  transit_h_p90: number;
  distance_mi: number;
  /**
   * US dollars, 2-decimal precision.
   */
  cost_per_load_usd: number;
}
