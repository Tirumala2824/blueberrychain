/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Soft constraints: kept, but they lower confidence or require approval.
 */
export type Flags = (
  | "LOW_CONFIDENCE"
  | "INVENTORY_STALE"
  | "INSUFFICIENT_EVIDENCE"
  | "MODEL_EXTRAPOLATING"
  | "CONTRACT_CONSENT_REQUIRED"
  | "PROXY_AIR_ONLY"
)[];
/**
 * Hard constraints that remove this option (empty when feasible).
 */
export type Eliminations = {
  code:
    | "FOOD_SAFETY"
    | "SPEC_INFEASIBLE"
    | "WINDOW_CLOSED"
    | "CAPACITY"
    | "ORGANIC_INTEGRITY"
    | "CONTRACT_PROHIBITS"
    | "INVENTORY_STALE"
    | "INSUFFICIENT_EVIDENCE";
  detail: string;
  /**
   * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
   */
  evidence_id?: string;
}[];

/**
 * Answers the six questions for one case and decision point: what if we do nothing, what if A / B, what each option is worth, what rules options out, and what to choose and why. Sealed and hashed; approvals bind to brief_hash.
 */
export interface DecisionBrief {
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  pack_id: string;
  brief_hash: string;
  generated_at: string;
  /**
   * Q1 - the default option, always evaluated.
   */
  do_nothing: {
    option_id: string;
    outcome: Outcome;
  };
  /**
   * Q2/Q3 - every feasible option with its full outcome.
   */
  options: {
    option_id: string;
    label: string;
    outcome: Outcome;
    flags: Flags;
    expires_at: string;
  }[];
  /**
   * Q4 - expected value of each option and its range.
   */
  value_table: {
    option_id: string;
    /**
     * US dollars, 2-decimal precision.
     */
    expected_nrv_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    nrv_p10_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    nrv_p90_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    value_preserved_vs_default_usd: number;
  }[];
  /**
   * Q5 - options removed by hard constraints, with reasons.
   */
  eliminated: {
    option_id: string;
    label: string;
    reasons: Eliminations;
  }[];
  comparison: {
    ranking: string[];
    non_dominated: string[];
    margin_top2_usd: number | null;
    objective_version: string;
    escalation_reasons: (
      | "NO_FEASIBLE_OPTION"
      | "NEAR_TIE"
      | "HIGH_EXPOSURE"
      | "EVIDENCE_CONFLICT"
      | "STRATEGIC_CUSTOMER"
      | "MULTI_PARTY_LIABILITY"
      | "CAUSE_AMBIGUOUS"
      | "MODEL_OUT_OF_RANGE"
      | "QUALITATIVE_SIGNAL"
      | "PRECEDENT_CONFLICT"
      | "NOVEL"
    )[];
    p_liab_attribution_only?: number | null;
    p_liab_with_finding?: number | null;
  };
  /**
   * @maxItems 10
   */
  precedents:
    | []
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ]
    | [
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        },
        {
          case_id: string;
          similarity: number;
          action_kind: string;
          decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
          value_protected_expost_usd?: number | null;
          sl_prediction_error_days?: number | null;
          /**
           * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
           */
          evidence_id: string;
        }
      ];
  /**
   * Q6 - the choice and why. Rule decisions carry a template narrative; agent decisions carry an audited one.
   */
  recommendation: {
    option_id: string;
    rec_id?: string;
    decided_by: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
    /**
     * Rule id@version, agent name@spec version, or user name.
     */
    decider_id: string;
    /**
     * Reason codes, e.g. HIGHEST_RISK_ADJUSTED_NRV, NO_TIER_A_SHORTFALL, MEETS_SPEC_P_ACCEPT.
     */
    why_structured: string[];
    narrative: string;
  };
}
export interface Outcome {
  operational: {
    p_accept: number;
    sl_at_arrival_days_p10?: number | null;
    sl_at_arrival_days_p50?: number | null;
    sl_at_arrival_days_p90?: number | null;
    eta_p50_at?: string | null;
    eta_p90_at?: string | null;
    /**
     * Kilograms, 3-decimal precision.
     */
    kg_delivered_expected: number;
  };
  financial: {
    /**
     * US dollars, 2-decimal precision.
     */
    expected_revenue_usd: number;
    costs: {
      /**
       * US dollars, 2-decimal precision.
       */
      freight_delta_usd?: number;
      /**
       * US dollars, 2-decimal precision.
       */
      expedite_usd?: number;
      /**
       * US dollars, 2-decimal precision.
       */
      inspection_usd?: number;
      /**
       * US dollars, 2-decimal precision.
       */
      transload_usd?: number;
      /**
       * US dollars, 2-decimal precision.
       */
      disposal_usd?: number;
      /**
       * US dollars, 2-decimal precision.
       */
      replacement_usd?: number;
    };
    /**
     * US dollars, 2-decimal precision.
     */
    expected_penalties_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    expected_recovery_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    expected_nrv_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    nrv_p10_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    nrv_p90_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    expected_loss_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    value_preserved_vs_default_usd: number;
  };
  risk: {
    p_reject: number;
    food_safety_flag: boolean;
    evidence_risk?: "HIGH" | "MEDIUM" | "LOW";
  };
  customer: {
    lines_affected: number;
    p_otif_by_line?: {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      order_line_id: string;
      p_otif: number;
    }[];
    /**
     * Kilograms, 3-decimal precision.
     */
    tier_a_shortfall_kg: number;
  };
  logistics: {
    added_hours?: number;
    added_miles?: number;
    carrier_change?: boolean;
    new_appointments?: number;
  };
  inventory: {
    atp_consumed?: {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      site_id: string;
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id?: string;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
      share_of_site_atp?: number;
    }[];
    /**
     * Kilograms, 3-decimal precision.
     */
    atp_added_kg?: number;
  };
  /**
   * US dollars, 2-decimal precision.
   */
  recovery_cost_usd: number;
  confidence: {
    level: "HIGH" | "MEDIUM" | "LOW";
    /**
     * @maxItems 10
     */
    drivers:
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
  };
}
