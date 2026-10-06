/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * S2 - claim-amount variants with expected recovery; never above claimable or cap; settlement band from GOV.
 */
export interface SIMULATE_CLAIM_VARIANTSInput {
  run_id: string;
  case_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  counterparty_id: string;
  basis: "CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY";
  /**
   * @minItems 1
   */
  variants: ["FULL" | "CAPPED" | "SETTLEMENT_BAND", ...("FULL" | "CAPPED" | "SETTLEMENT_BAND")[]];
}
