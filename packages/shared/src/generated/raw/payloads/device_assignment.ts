/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Which device measures which lot or shipment, and in what role. Source: packhouse / IoT platform.
 */
export interface DeviceAssignment {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  device_id: string;
  target_type: "LOT" | "SHIPMENT";
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  target_id: string;
  role: "PRIMARY" | "SECONDARY" | "REEFER";
  assigned_from: string;
  assigned_to?: string | null;
}
