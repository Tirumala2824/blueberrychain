/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A physical location: ranch block, packhouse, DC, customer DC, processor, route junction.
 */
export interface ReferenceSite {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  site_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  party_id: string;
  site_type: "RANCH_BLOCK" | "PACKHOUSE" | "DC" | "CUSTOMER_DC" | "PROCESSOR" | "JUNCTION";
  name: string;
  city?: string | null;
  state?: string | null;
  lat: number;
  lon: number;
  sap_plant?: string | null;
  dock_capacity_kg_per_day?: number | null;
}
