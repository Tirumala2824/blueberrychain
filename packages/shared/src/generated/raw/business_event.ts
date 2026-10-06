/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Append-only envelope for every non-telemetry record. The sink MERGEs on idempotency_key (see contracts/schemas/raw/README.md), so retries never duplicate. OPS Dynamic Tables type the payload by entity_type.
 */
export type RAWBUSINESS_EVENTSRow = {
  [k: string]: unknown;
} & {
  source_system: "SAP" | "TMS" | "PACKHOUSE" | "IOT_PLATFORM" | "FILES";
  entity_type:
    | "CLAIM_RESPONSE"
    | "CUSTODY_EVENT"
    | "DELIVERY"
    | "DEVICE_ASSIGNMENT"
    | "DOCUMENT_META"
    | "INSPECTION_RESULT"
    | "LOT"
    | "SALES_ORDER_ITEM"
    | "SHIPMENT"
    | "SHIPMENT_STATUS"
    | "STOCK_SNAPSHOT";
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  external_id: string;
  /**
   * Business time of the record (change time for master/transactional records, occurrence time for events).
   */
  event_ts: string;
  idempotency_key: string;
  connector_id: string;
  /**
   * Defaults to LIVE when absent.
   */
  provenance?: "LIVE" | "SIMULATION_BACKFILL" | "SIMULATION_LIVE";
  payload: {};
};
