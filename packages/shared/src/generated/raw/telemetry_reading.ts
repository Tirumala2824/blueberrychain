/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * One sensor reading. Pulp probes report pulp_c; reefer units report air temperatures, setpoint, mode, door and alarms. API.INGEST_BATCH MERGEs on idempotency_key (the canonical hash of {kind: TELEMETRY, device_id, reading_ts}; see bbc_toolkit.raw) so retries never double-count reading minutes.
 */
export interface RAWTELEMETRYRow {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  device_id: string;
  reading_ts: string;
  /**
   * Sampling interval this reading represents (used for minute-weighted physics).
   */
  interval_s: number;
  idempotency_key: string;
  connector_id: string;
  provenance?: "LIVE" | "SIMULATION_BACKFILL" | "SIMULATION_LIVE";
  readings: {
    pulp_c?: number;
    supply_air_c?: number;
    return_air_c?: number;
    setpoint_c?: number;
    ambient_c?: number;
    mode?: "CONTINUOUS" | "CYCLE_SENTRY" | "DEFROST" | "OFF";
    door_open?: boolean;
    alarms?: string[];
    lat?: number;
    lon?: number;
    battery_pct?: number;
  };
}
