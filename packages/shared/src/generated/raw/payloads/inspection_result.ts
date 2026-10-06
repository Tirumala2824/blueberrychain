/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * QC inspection lot result (SAP API_INSPECTIONLOT_SRV, mapped). Receipt inspections are outcome evidence. Source: SAP QM.
 */
export interface InspectionResult {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  inspection_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  site_id: string;
  inspection_type: "ORIGIN" | "INTERMEDIATE" | "RECEIPT";
  inspected_at: string;
  pulp_c?: number | null;
  defects_pct?: number | null;
  decay_pct?: number | null;
  remaining_shelf_life_days_observed?: number | null;
  accepted: boolean;
  inspector?: string | null;
}
