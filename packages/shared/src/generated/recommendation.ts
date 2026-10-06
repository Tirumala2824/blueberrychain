/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * @maxItems 100
 */
export type Citations = string[];

/**
 * What the Recovery Strategist submits through SUBMIT_RECOMMENDATION (D1). The server checks the option is in the current scored set, feasible and unexpired at now + approval buffer; that every non-dominated option is explicitly rejected; that deviation_reason is present when the choice is not the top risk-adjusted score; that robustness claims reference simulation calls made in this run; and that every number in the text matches a tool-supplied value.
 */
export interface RecommendationPayload {
  option_id: string;
  rejected_alternatives: {
    option_id: string;
    reason: string;
  }[];
  trade_off: string;
  robustness: {
    stable: boolean;
    /**
     * TOOL_CALLS seq numbers of SIMULATE_OPTION_VARIANTS calls in this run that support the claim.
     */
    simulation_call_seqs: number[];
  };
  would_change_if: string;
  /**
   * Empty string when the choice is the top risk-adjusted option.
   */
  deviation_reason: string;
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
  citations: Citations;
}
