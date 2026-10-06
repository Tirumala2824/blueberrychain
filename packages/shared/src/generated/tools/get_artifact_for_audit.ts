/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * R6 - an artifact with its citations resolved. Auditor only; denied when the auditor model is not independent of the author's.
 */
export interface GET_ARTIFACT_FOR_AUDITInput {
  run_id: string;
  /**
   * An AI-written artifact awaiting audit: a causation finding or a recommendation.
   */
  artifact_id: string;
}
