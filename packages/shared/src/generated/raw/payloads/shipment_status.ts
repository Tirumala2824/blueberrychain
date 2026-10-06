/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Position / status / ETA update. Source: TMS.
 */
export interface ShipmentStatusEvent {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  shipment_id: string;
  status: "PLANNED" | "LOADING" | "IN_TRANSIT" | "AT_DOCK" | "DELIVERED" | "REJECTED" | "CANCELLED";
  at: string;
  lat?: number | null;
  lon?: number | null;
  next_junction_site_id?: string | null;
  destination_site_id?: string | null;
  eta_at?: string | null;
}
