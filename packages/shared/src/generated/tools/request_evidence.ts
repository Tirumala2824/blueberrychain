/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * M1 - the only operational write an agent can trigger: a governed REQUEST_EVIDENCE mutation (policy-evaluated, deduplicated, at most 3 per case per type).
 */
export interface REQUEST_EVIDENCEInput {
  run_id: string;
  case_id: string;
  request: {
    evidence_type: "REEFER_DOWNLOAD" | "BOL_COPY" | "REINSPECTION" | "PHOTOS" | "TEMP_RECORDER_FILE";
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    from_party_id: string;
    reason: string;
    needed_by_ts: string;
  };
}
