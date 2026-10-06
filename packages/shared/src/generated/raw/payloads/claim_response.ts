/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A counterparty's response to a claim or notice. Source: TMS / carrier.
 */
export interface ClaimResponse {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  response_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  claim_ref: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  counterparty_party_id: string;
  response_type: "ACKNOWLEDGED" | "DENIED" | "PARTIAL_OFFER" | "PAID" | "REQUEST_DOCS";
  amount_usd?: number | null;
  defense?:
    | "WARM_LOADING"
    | "SETPOINT_NOT_ON_BOL"
    | "SENSOR_UNRELIABLE"
    | "NO_MITIGATION"
    | "LIABILITY_CAP"
    | "LATE_NOTICE"
    | "OTHER"
    | null;
  text?: string | null;
  at: string;
}
