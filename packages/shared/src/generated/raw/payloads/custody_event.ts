/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A change of custody or a load/unload/arrive/depart event. Source: TMS / packhouse / DC.
 */
export interface CustodyEvent {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  event_id: string;
  event_type: "HANDOFF" | "LOAD" | "UNLOAD" | "ARRIVE" | "DEPART";
  at: string;
  shipment_id?: string | null;
  lot_id?: string | null;
  from_party_id: string | null;
  to_party_id: string | null;
  site_id?: string | null;
}
