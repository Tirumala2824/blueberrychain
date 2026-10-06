/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A complete, versioned policy (GOV). Drafted as data, validated against this schema, activated only through API.ACTIVATE_POLICY (ledgered).
 */
export interface PolicyDocument {
  policy_version: string;
  description: string;
  parameters: {
    autonomy_ceiling: number;
    shadow_mode: boolean;
    fallback_enabled: boolean;
    dispatch_enabled: boolean;
    approval_buffer_min: number;
    min_acceptance_probability: number;
    risk_aversion_lambda: number;
    tier_a_weight_kappa_usd_per_kg: number;
    near_tie_margin_pct: number;
    /**
     * US dollars, 2-decimal precision.
     */
    near_tie_margin_usd: number;
    /**
     * US dollars, 2-decimal precision.
     */
    high_exposure_usd: number;
    detection_window_min: number;
    consistency_tolerance_c: number;
    fault_persistence_prior: number;
    failure_to_mitigate_factor: number;
    /**
     * P(liability) by causation-finding confidence; ATTRIBUTION_ONLY is used when no finding exists or confidence is LOW.
     */
    p_liab_by_finding: {
      HIGH: number;
      MEDIUM: number;
      LOW: number;
      ATTRIBUTION_ONLY: number;
    };
    montecarlo_samples: number;
    staleness_limit_min: number;
    snapshot_staleness_limit_h: number;
    min_evidence_coverage_pct: number;
    settlement_band_pct: {
      min: number;
      max: number;
    };
    agent_call_budget: number;
  };
  /**
   * @minItems 1
   */
  decision_rights: [
    {
      rule_id: string;
      priority: number;
      /**
       * All present conditions must hold for the rule to match.
       */
      conditions: {
        action_types?: (
          | "STOCK_BLOCK"
          | "STOCK_UNBLOCK"
          | "REQUEST_EVIDENCE"
          | "WITHDRAW_REQUEST"
          | "CLAIM_NOTICE"
          | "WITHDRAW_NOTICE"
          | "SO_CHANGE"
          | "SO_REVERT"
          | "REPLACEMENT_ALLOCATION"
          | "DEALLOCATE"
          | "REROUTE"
          | "REROUTE_BACK"
          | "REPROMISE_NOTICE"
          | "CORRECTION_NOTICE"
          | "SO_CREATE"
          | "CANCEL_SO"
          | "DISPOSE"
          | "FILE_CLAIM"
          | "WITHDRAW_CLAIM"
          | "GROWER_DEDUCTION"
          | "ABSORB"
          | "REVERSAL_POSTING"
          | "CASE_STATE"
        )[];
        decision_points?: ("D1" | "D2")[];
        decider_kinds?: ("RULE" | "AGENT" | "HUMAN" | "FALLBACK")[];
        /**
         * US dollars, 2-decimal precision.
         */
        min_value_usd?: number;
        /**
         * US dollars, 2-decimal precision.
         */
        max_value_usd?: number;
        customer_tiers?: ("A" | "B" | "C")[];
        food_safety_flag?: boolean;
        min_confidence?: "HIGH" | "MEDIUM" | "LOW";
      };
      outcome: "AUTO" | "APPROVE" | "DENY" | "SHADOW";
      required_roles: string[];
      note?: string;
    },
    ...{
      rule_id: string;
      priority: number;
      /**
       * All present conditions must hold for the rule to match.
       */
      conditions: {
        action_types?: (
          | "STOCK_BLOCK"
          | "STOCK_UNBLOCK"
          | "REQUEST_EVIDENCE"
          | "WITHDRAW_REQUEST"
          | "CLAIM_NOTICE"
          | "WITHDRAW_NOTICE"
          | "SO_CHANGE"
          | "SO_REVERT"
          | "REPLACEMENT_ALLOCATION"
          | "DEALLOCATE"
          | "REROUTE"
          | "REROUTE_BACK"
          | "REPROMISE_NOTICE"
          | "CORRECTION_NOTICE"
          | "SO_CREATE"
          | "CANCEL_SO"
          | "DISPOSE"
          | "FILE_CLAIM"
          | "WITHDRAW_CLAIM"
          | "GROWER_DEDUCTION"
          | "ABSORB"
          | "REVERSAL_POSTING"
          | "CASE_STATE"
        )[];
        decision_points?: ("D1" | "D2")[];
        decider_kinds?: ("RULE" | "AGENT" | "HUMAN" | "FALLBACK")[];
        /**
         * US dollars, 2-decimal precision.
         */
        min_value_usd?: number;
        /**
         * US dollars, 2-decimal precision.
         */
        max_value_usd?: number;
        customer_tiers?: ("A" | "B" | "C")[];
        food_safety_flag?: boolean;
        min_confidence?: "HIGH" | "MEDIUM" | "LOW";
      };
      outcome: "AUTO" | "APPROVE" | "DENY" | "SHADOW";
      required_roles: string[];
      note?: string;
    }[]
  ];
  /**
   * @minItems 1
   */
  router_rules: [
    {
      trigger:
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
        | "NOVEL";
      enabled: boolean;
      target_agent: "EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY";
      params?: {};
    },
    ...{
      trigger:
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
        | "NOVEL";
      enabled: boolean;
      target_agent: "EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY";
      params?: {};
    }[]
  ];
  /**
   * @minItems 1
   */
  hard_limits: [
    {
      limit_id: string;
      product_id: string | "*";
      max_pulp_c: number;
      max_minutes_above: number;
      consequence: "INSPECT_HOLD_OR_DISPOSE_ONLY";
    },
    ...{
      limit_id: string;
      product_id: string | "*";
      max_pulp_c: number;
      max_minutes_above: number;
      consequence: "INSPECT_HOLD_OR_DISPOSE_ONLY";
    }[]
  ];
  autonomy_thresholds: {
    /**
     * @minItems 1
     */
    financial: [
      {
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      },
      ...{
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      }[]
    ];
    /**
     * @minItems 1
     */
    customer: [
      {
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      },
      ...{
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      }[]
    ];
    /**
     * @minItems 1
     */
    inventory: [
      {
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      },
      ...{
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      }[]
    ];
    /**
     * @minItems 1
     */
    operational: [
      {
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      },
      ...{
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      }[]
    ];
    /**
     * @minItems 1
     */
    confidence: [
      {
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      },
      ...{
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      }[]
    ];
    /**
     * @minItems 1
     */
    data_quality: [
      {
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      },
      ...{
        metric: string;
        l3_max: number | boolean | string;
        l4_max: number | boolean | string | null;
        beyond_l4?: "DUAL_APPROVAL" | "L2" | "L1" | "FALLBACK_ONLY";
        approver_roles?: string[];
      }[]
    ];
  };
  /**
   * @minItems 1
   */
  action_types: [
    {
      action_type:
        | "STOCK_BLOCK"
        | "STOCK_UNBLOCK"
        | "REQUEST_EVIDENCE"
        | "WITHDRAW_REQUEST"
        | "CLAIM_NOTICE"
        | "WITHDRAW_NOTICE"
        | "SO_CHANGE"
        | "SO_REVERT"
        | "REPLACEMENT_ALLOCATION"
        | "DEALLOCATE"
        | "REROUTE"
        | "REROUTE_BACK"
        | "REPROMISE_NOTICE"
        | "CORRECTION_NOTICE"
        | "SO_CREATE"
        | "CANCEL_SO"
        | "DISPOSE"
        | "FILE_CLAIM"
        | "WITHDRAW_CLAIM"
        | "GROWER_DEDUCTION"
        | "ABSORB"
        | "REVERSAL_POSTING"
        | "CASE_STATE";
      target_system: "SAP" | "TMS" | "CARRIER" | "CUSTOMER_EDI" | "EMAIL" | "INTERNAL";
      reversibility: "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE";
      max_level: number;
      compensation:
        | (
            | "STOCK_BLOCK"
            | "STOCK_UNBLOCK"
            | "REQUEST_EVIDENCE"
            | "WITHDRAW_REQUEST"
            | "CLAIM_NOTICE"
            | "WITHDRAW_NOTICE"
            | "SO_CHANGE"
            | "SO_REVERT"
            | "REPLACEMENT_ALLOCATION"
            | "DEALLOCATE"
            | "REROUTE"
            | "REROUTE_BACK"
            | "REPROMISE_NOTICE"
            | "CORRECTION_NOTICE"
            | "SO_CREATE"
            | "CANCEL_SO"
            | "DISPOSE"
            | "FILE_CLAIM"
            | "WITHDRAW_CLAIM"
            | "GROWER_DEDUCTION"
            | "ABSORB"
            | "REVERSAL_POSTING"
            | "CASE_STATE"
          )
        | null;
      preconditions?: string[];
    },
    ...{
      action_type:
        | "STOCK_BLOCK"
        | "STOCK_UNBLOCK"
        | "REQUEST_EVIDENCE"
        | "WITHDRAW_REQUEST"
        | "CLAIM_NOTICE"
        | "WITHDRAW_NOTICE"
        | "SO_CHANGE"
        | "SO_REVERT"
        | "REPLACEMENT_ALLOCATION"
        | "DEALLOCATE"
        | "REROUTE"
        | "REROUTE_BACK"
        | "REPROMISE_NOTICE"
        | "CORRECTION_NOTICE"
        | "SO_CREATE"
        | "CANCEL_SO"
        | "DISPOSE"
        | "FILE_CLAIM"
        | "WITHDRAW_CLAIM"
        | "GROWER_DEDUCTION"
        | "ABSORB"
        | "REVERSAL_POSTING"
        | "CASE_STATE";
      target_system: "SAP" | "TMS" | "CARRIER" | "CUSTOMER_EDI" | "EMAIL" | "INTERNAL";
      reversibility: "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE";
      max_level: number;
      compensation:
        | (
            | "STOCK_BLOCK"
            | "STOCK_UNBLOCK"
            | "REQUEST_EVIDENCE"
            | "WITHDRAW_REQUEST"
            | "CLAIM_NOTICE"
            | "WITHDRAW_NOTICE"
            | "SO_CHANGE"
            | "SO_REVERT"
            | "REPLACEMENT_ALLOCATION"
            | "DEALLOCATE"
            | "REROUTE"
            | "REROUTE_BACK"
            | "REPROMISE_NOTICE"
            | "CORRECTION_NOTICE"
            | "SO_CREATE"
            | "CANCEL_SO"
            | "DISPOSE"
            | "FILE_CLAIM"
            | "WITHDRAW_CLAIM"
            | "GROWER_DEDUCTION"
            | "ABSORB"
            | "REVERSAL_POSTING"
            | "CASE_STATE"
          )
        | null;
      preconditions?: string[];
    }[]
  ];
  /**
   * @minItems 1
   */
  model_registry: [
    {
      agent: "EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY" | "EVIDENCE_AUDITOR";
      provider: "CORTEX" | "ANTHROPIC" | "OPENAI_COMPATIBLE";
      model: string;
      role: "PRIMARY" | "FALLBACK";
      data_classes: ("OPERATIONAL" | "COMMERCIAL" | "CONTRACTUAL")[];
      must_differ_from_author?: boolean;
    },
    ...{
      agent: "EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY" | "EVIDENCE_AUDITOR";
      provider: "CORTEX" | "ANTHROPIC" | "OPENAI_COMPATIBLE";
      model: string;
      role: "PRIMARY" | "FALLBACK";
      data_classes: ("OPERATIONAL" | "COMMERCIAL" | "CONTRACTUAL")[];
      must_differ_from_author?: boolean;
    }[]
  ];
  /**
   * @minItems 1
   */
  metric_registry: [
    {
      name: string;
      version: string;
      canonical: boolean;
      unit: string;
      grain: string;
      owner_role: string;
      staleness_limit_min?: number | null;
      allowed_dimensions?: string[];
    },
    ...{
      name: string;
      version: string;
      canonical: boolean;
      unit: string;
      grain: string;
      owner_role: string;
      staleness_limit_min?: number | null;
      allowed_dimensions?: string[];
    }[]
  ];
}
