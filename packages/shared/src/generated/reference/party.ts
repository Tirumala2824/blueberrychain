/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A company in the world: growers, packhouse, carriers, our DC operator, customers, processors.
 */
export interface ReferenceParty {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  party_id: string;
  party_type: "OWN" | "GROWER" | "PACKHOUSE" | "CARRIER" | "CUSTOMER" | "PROCESSOR";
  name: string;
  customer_tier?: ("A" | "B" | "C") | null;
  sap_business_partner?: string | null;
  account_notes?: string | null;
  /**
   * Channel a customer or processor buys through (prices: REF.CHANNEL_PRICES); re-route destinations are priced by it.
   */
  sales_channel?: ("CONTRACT" | "REGIONAL" | "FOODSERVICE" | "PROCESSOR" | "DONATION") | null;
}
