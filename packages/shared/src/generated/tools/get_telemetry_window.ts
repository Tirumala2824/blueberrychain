/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * R2 - time-series evidence for a lot or its reefer. Window must lie between harvest and the pack as_of; at most 2,000 points; RAW resolution only for windows up to 6 h.
 */
export interface GET_TELEMETRY_WINDOWInput {
  run_id: string;
  case_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  from_ts: string;
  to_ts: string;
  resolution: "RAW" | "BUCKET_15M" | "BUCKET_60M";
  /**
   * @minItems 1
   */
  channels: [
    "PULP" | "SUPPLY_AIR" | "RETURN_AIR" | "SETPOINT" | "DOOR" | "ALARM" | "MODE",
    ...("PULP" | "SUPPLY_AIR" | "RETURN_AIR" | "SETPOINT" | "DOOR" | "ALARM" | "MODE")[]
  ];
}
