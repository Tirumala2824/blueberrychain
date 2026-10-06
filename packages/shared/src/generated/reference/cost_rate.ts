/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A cost the evaluation engine prices options with.
 */
export interface ReferenceCostRate {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  cost_rate_id: string;
  cost_type:
    | "INSPECTION"
    | "TRANSLOAD"
    | "DISPOSAL"
    | "HANDLING"
    | "EXPEDITE_PREMIUM"
    | "REROUTE_ADMIN"
    | "RETURN_FREIGHT"
    | "REPLACEMENT_TRANSFER"
    | "DETENTION";
  scope_type: "GLOBAL" | "SITE" | "LANE";
  scope_id: string | null;
  rate: number;
  unit: "USD_PER_EVENT" | "USD_PER_KG" | "USD_PER_LOAD" | "PCT_OF_VALUE" | "USD_PER_HOUR";
}
