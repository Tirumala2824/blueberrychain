/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * @maxItems 100
 */
export type Citations = string[];

/**
 * G2 - the Auditor's verdict on an artifact (veto only; cannot edit content).
 */
export interface SUBMIT_AUDIT_VERDICTInput {
  run_id: string;
  /**
   * An AI-written artifact awaiting audit: a causation finding or a recommendation.
   */
  artifact_id: string;
  verdict: AuditVerdictPayload;
}
/**
 * What the Evidence Integrity Auditor submits through SUBMIT_AUDIT_VERDICT. Any CONTRADICTED statement forces FAIL; every sentence of the artifact that carries a number or factual claim must be covered (checked deterministically); the auditor's model must differ from the author's when the model registry requires independence.
 */
export interface AuditVerdictPayload {
  /**
   * @minItems 1
   */
  statements: [
    {
      span: {
        start: number;
        end: number;
      };
      statement: string;
      verdict: "SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED";
      evidence_ids: Citations;
    },
    ...{
      span: {
        start: number;
        end: number;
      };
      statement: string;
      verdict: "SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED";
      evidence_ids: Citations;
    }[]
  ];
  overall: "PASS" | "FAIL";
  /**
   * @maxItems 20
   */
  required_fixes:
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
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
}
