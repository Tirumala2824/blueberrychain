/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A4 - deterministic loss, cap, claimable amount, filing deadline, prerequisites and required documents.
 */
export interface COMPUTE_CLAIM_BASISInput {
  run_id: string;
  case_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  counterparty_id: string;
  basis: "CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY";
}
