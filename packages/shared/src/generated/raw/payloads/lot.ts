/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A harvested, packed lot (SAP batch). Source: SAP / packhouse.
 */
export interface HarvestLot {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  product_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  grower_party_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  harvest_site_id: string;
  packhouse_site_id?: string | null;
  harvest_at: string;
  packed_at?: string | null;
  /**
   * Kilograms, 3-decimal precision.
   */
  kg: number;
  organic: boolean;
}
