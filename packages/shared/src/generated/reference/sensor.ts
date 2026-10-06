/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A measuring device and how far its readings can be trusted.
 */
export interface ReferenceSensor {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  device_id: string;
  device_type: "PULP_PROBE" | "REEFER_UNIT";
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  owner_party_id: string;
  placement: "CORE_PULP" | "PALLET_TOP" | "RETURN_AIR" | "SUPPLY_AIR";
  calibrated_on: string | null;
  accuracy_c: number;
}
