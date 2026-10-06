/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A planned or active shipment with its lots and BOL setpoint. Source: TMS.
 */
export interface Shipment {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  shipment_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  carrier_party_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  origin_site_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  destination_site_id: string;
  planned_departure_at: string;
  planned_arrival_at: string;
  reefer_device_id: string | null;
  bol_setpoint_c: number | null;
  /**
   * @minItems 1
   */
  lots: [
    {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
    },
    ...{
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
    }[]
  ];
  status: "PLANNED" | "LOADING" | "IN_TRANSIT" | "AT_DOCK" | "DELIVERED" | "REJECTED" | "CANCELLED";
}
