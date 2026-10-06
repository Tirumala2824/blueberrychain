/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * What a device platform POSTs to connector-iot at /v1/telemetry. The body is signed: X-BBC-Timestamp is Unix seconds and X-BBC-Signature is 'v1=' + hex(HMAC-SHA256(secret, timestamp + '.' + raw body)); requests older than 5 minutes are refused. The connector maps each message to one RAW.TELEMETRY row and computes its idempotency key, so a platform may resend a batch safely.
 */
export interface IoTWebhookBatch {
  /**
   * Sending platform, for logs only.
   */
  source?: string;
  /**
   * @minItems 1
   * @maxItems 5000
   */
  messages: [
    {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      device_id: string;
      ts: string;
      interval_s: number;
      values: Readings;
      provenance?: "LIVE" | "SIMULATION_BACKFILL" | "SIMULATION_LIVE";
    },
    ...{
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      device_id: string;
      ts: string;
      interval_s: number;
      values: Readings;
      provenance?: "LIVE" | "SIMULATION_BACKFILL" | "SIMULATION_LIVE";
    }[]
  ];
}
export interface Readings {
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
}
