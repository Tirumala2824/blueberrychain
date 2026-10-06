/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * What a device platform POSTs to connector-iot at /v1/pairings when a device is attached to, or removed from, what it measures: a pulp probe to a lot (PRIMARY / SECONDARY), a reefer unit to a shipment (REEFER). Signed exactly like /v1/telemetry. Each pairing becomes one RAW.BUSINESS_EVENTS row (entity DEVICE_ASSIGNMENT, source IOT_PLATFORM); a later message with the same pairing_id and assigned_to closes it.
 */
export interface IoTPairingBatch {
  source?: string;
  /**
   * @minItems 1
   * @maxItems 1000
   */
  pairings: [
    {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      pairing_id: string;
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
      /**
       * When the platform recorded this version of the pairing.
       */
      changed_at: string;
      provenance?: "LIVE" | "SIMULATION_BACKFILL" | "SIMULATION_LIVE";
    },
    ...{
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      pairing_id: string;
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
      /**
       * When the platform recorded this version of the pairing.
       */
      changed_at: string;
      provenance?: "LIVE" | "SIMULATION_BACKFILL" | "SIMULATION_LIVE";
    }[]
  ];
}
