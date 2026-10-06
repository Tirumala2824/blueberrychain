/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Metadata for a file the files connector placed on EVIDENCE.DOC_STAGE. Source: files connector.
 */
export interface DocumentMetadata {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  doc_id: string;
  doc_type:
    | "INSPECTION_CERT"
    | "BOL"
    | "RECEIVING_REPORT"
    | "REEFER_DOWNLOAD"
    | "INCIDENT_NOTE"
    | "CLAIM_CORRESPONDENCE"
    | "CONTRACT";
  stage_path: string;
  sha256: string;
  source: string;
  lot_id?: string | null;
  shipment_id?: string | null;
  contract_id?: string | null;
}
