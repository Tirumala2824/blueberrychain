/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Structured terms plus clause text. Terms shape depends on contract_type.
 */
export type ReferenceContract = {
  [k: string]: unknown;
} & {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  contract_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  party_id: string;
  contract_type: "CARRIER_TRANSPORT" | "GROWER_SUPPLY" | "CUSTOMER_SALES";
  terms: {};
  clause_text: string;
  source_doc_id?: string | null;
  effective_from: string;
};
