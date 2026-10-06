/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * @maxItems 100
 */
export type Citations = string[];

/**
 * C3 - record the Claims & Recovery decision (writes a proposal record only).
 */
export interface SUBMIT_CLAIM_RECOMMENDATIONInput {
  run_id: string;
  case_id: string;
  claim_rec: ClaimRecommendationPayload;
}
/**
 * What the Claims & Recovery agent submits through SUBMIT_CLAIM_RECOMMENDATION. Amounts come only from variant_option_id (calculator-generated). FILE_CLAIM needs a SUFFICIENT finding with confidence >= MEDIUM, all prerequisites satisfied and the filing deadline open; COUNTER / ACCEPT_OFFER must sit inside the policy settlement band.
 */
export interface ClaimRecommendationPayload {
  action:
    "CLAIM_NOTICE" | "FILE_CLAIM" | "GROWER_DEDUCTION" | "ABSORB" | "DEFER" | "ACCEPT_OFFER" | "COUNTER" | "APPEAL";
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  counterparty_id: string;
  basis: "CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY";
  /**
   * Required for FILE_CLAIM, GROWER_DEDUCTION, COUNTER and ACCEPT_OFFER; null for NOTICE / ABSORB / DEFER / APPEAL.
   */
  variant_option_id: string | null;
  prerequisites_ack: (
    "NOTICE_TIMELY" | "MITIGATION_EVIDENCED" | "SETPOINT_ON_BOL" | "CUSTODY_PROVEN" | "DOCS_COMPLETE"
  )[];
  anticipated_defenses: {
    defense:
      | "WARM_LOADING"
      | "SETPOINT_NOT_ON_BOL"
      | "SENSOR_UNRELIABLE"
      | "NO_MITIGATION"
      | "LIABILITY_CAP"
      | "LATE_NOTICE"
      | "OTHER";
    rebuttal: string;
    evidence_ids: Citations;
  }[];
  letter_draft: string;
  /**
   * Counterparty response id being answered, or empty string.
   */
  response_to: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  citations: Citations;
}
