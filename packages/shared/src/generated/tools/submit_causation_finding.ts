/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * @maxItems 100
 */
export type Citations = string[];

/**
 * C1 - record the Forensics finding (writes a proposal record only).
 */
export interface SUBMIT_CAUSATION_FINDINGInput {
  run_id: string;
  case_id: string;
  finding: CausationFindingPayload;
}
/**
 * What the Excursion Forensics agent submits through SUBMIT_CAUSATION_FINDING. The server adds finding_id, decider, run_id and timestamps, caps confidence by evidence coverage, and rejects parties that never held custody of the case lots.
 */
export interface CausationFindingPayload {
  /**
   * @minItems 1
   */
  hypotheses: [
    {
      cause:
        | "REEFER_MALFUNCTION"
        | "SETPOINT_MISMATCH"
        | "WARM_LOADING"
        | "PRECOOL_DELAY"
        | "DOCK_DWELL"
        | "DOOR_EVENTS"
        | "DEFROST_ARTIFACT"
        | "SENSOR_FAULT"
        | "UNKNOWN";
      verdict: "SUPPORTED" | "REJECTED" | "INCONCLUSIVE";
      evidence_ids: Citations;
    },
    ...{
      cause:
        | "REEFER_MALFUNCTION"
        | "SETPOINT_MISMATCH"
        | "WARM_LOADING"
        | "PRECOOL_DELAY"
        | "DOCK_DWELL"
        | "DOOR_EVENTS"
        | "DEFROST_ARTIFACT"
        | "SENSOR_FAULT"
        | "UNKNOWN";
      verdict: "SUPPORTED" | "REJECTED" | "INCONCLUSIVE";
      evidence_ids: Citations;
    }[]
  ];
  most_likely_cause:
    | "REEFER_MALFUNCTION"
    | "SETPOINT_MISMATCH"
    | "WARM_LOADING"
    | "PRECOOL_DELAY"
    | "DOCK_DWELL"
    | "DOOR_EVENTS"
    | "DEFROST_ARTIFACT"
    | "SENSOR_FAULT"
    | "UNKNOWN";
  responsible_parties: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    party_id: string;
    basis: "CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY";
    evidence_ids: Citations;
  }[];
  evidence_trust: {
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id: string;
    trust: "HIGH" | "MEDIUM" | "LOW";
    reason: string;
  }[];
  sufficiency: "SUFFICIENT" | "INSUFFICIENT";
  gaps: {
    description: string;
    closing_evidence_type: "REEFER_DOWNLOAD" | "BOL_COPY" | "REINSPECTION" | "PHOTOS" | "TEMP_RECORDER_FILE";
  }[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /**
   * @maxItems 10
   */
  confidence_reasons:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
  narrative: string;
  citations: Citations;
}
