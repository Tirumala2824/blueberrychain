/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * R3 - linked documents with extracted claims, consistency verdicts, narratives (untrusted text) and sensor metadata.
 */
export interface GET_DOCUMENT_EVIDENCEInput {
  run_id: string;
  case_id: string;
  /**
   * @minItems 1
   */
  doc_types: [
    (
      | "INSPECTION_CERT"
      | "BOL"
      | "RECEIVING_REPORT"
      | "REEFER_DOWNLOAD"
      | "INCIDENT_NOTE"
      | "CLAIM_CORRESPONDENCE"
      | "CONTRACT"
    ),
    ...(
      | "INSPECTION_CERT"
      | "BOL"
      | "RECEIVING_REPORT"
      | "REEFER_DOWNLOAD"
      | "INCIDENT_NOTE"
      | "CLAIM_CORRESPONDENCE"
      | "CONTRACT"
    )[]
  ];
  include_narratives: boolean;
}
