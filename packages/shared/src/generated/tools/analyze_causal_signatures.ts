/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A1 - deterministic physical indicators supporting or contradicting candidate causes. Thresholds come from versioned GOV parameters.
 */
export interface ANALYZE_CAUSAL_SIGNATURESInput {
  run_id: string;
  case_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  /**
   * @minItems 1
   */
  tests: [
    (
      | "WARM_LOADING"
      | "PRECOOL_DELAY"
      | "SETPOINT_MISMATCH"
      | "REEFER_PULLDOWN_FAILURE"
      | "DEFROST_ARTIFACT"
      | "DOOR_EVENTS"
      | "DOCK_DWELL"
      | "SENSOR_FAULT"
    ),
    ...(
      | "WARM_LOADING"
      | "PRECOOL_DELAY"
      | "SETPOINT_MISMATCH"
      | "REEFER_PULLDOWN_FAILURE"
      | "DEFROST_ARTIFACT"
      | "DOOR_EVENTS"
      | "DOCK_DWELL"
      | "SENSOR_FAULT"
    )[]
  ];
}
