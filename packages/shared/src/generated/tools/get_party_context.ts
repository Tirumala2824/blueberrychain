/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * R4 - customer / counterparty context. The party must be related to the case; aspects are allow-listed per agent.
 */
export interface GET_PARTY_CONTEXTInput {
  run_id: string;
  case_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  party_id: string;
  /**
   * @minItems 1
   */
  aspects: [
    (
      | "PROFILE"
      | "SPECS"
      | "CONTRACT_TERMS"
      | "CLAUSE_TEXT"
      | "PENALTIES"
      | "ACCOUNT_NOTES"
      | "CLAIM_HISTORY"
      | "RECENT_INCIDENTS"
    ),
    ...(
      | "PROFILE"
      | "SPECS"
      | "CONTRACT_TERMS"
      | "CLAUSE_TEXT"
      | "PENALTIES"
      | "ACCOUNT_NOTES"
      | "CLAIM_HISTORY"
      | "RECENT_INCIDENTS"
    )[]
  ];
}
