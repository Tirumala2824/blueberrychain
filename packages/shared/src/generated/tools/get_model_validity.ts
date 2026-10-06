/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A3 - whether the shelf-life model is valid for this lot's conditions.
 */
export interface GET_MODEL_VALIDITYInput {
  run_id: string;
  case_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
}
