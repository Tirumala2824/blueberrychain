/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * One candidate decision bundle and its deterministically evaluated outcome. Every number is produced by bbc_engine (seeded, versioned) - never by an LLM. Options are mutually exclusive alternatives and must never be aggregated.
 */
export interface Option {
  option_id: string;
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  option_set_rev: number;
  origin: "GENERATOR" | "AGENT_VARIANT";
  parent_option_id?: string | null;
  label: string;
  /**
   * The 'do nothing' option - always evaluated and never eliminated: it is the counterfactual every other option is measured against.
   */
  is_default: boolean;
  /**
   * The safe hold / inspect option the deadline watchdog may run.
   */
  is_fallback: boolean;
  bundle: {
    lots: {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      disposition: "CONTINUE" | "EXPEDITE" | "REROUTE" | "DOWNGRADE" | "INSPECT" | "HOLD" | "DISPOSE";
      destination_site_id?: string | null;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
      carrier_party_id?: string | null;
    }[];
    order_recovery: {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      order_line_id: string;
      action: "KEEP" | "FILL_FROM" | "PARTIAL" | "SHORT" | "REPROMISE";
      replacement_lot_id?: string | null;
      from_site_id?: string | null;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
      repromise_at?: string | null;
    }[];
    financial: {
      action:
        | "NONE"
        | "CLAIM_NOTICE"
        | "FILE_CLAIM"
        | "GROWER_DEDUCTION"
        | "ABSORB"
        | "DEFER"
        | "ACCEPT_OFFER"
        | "COUNTER"
        | "APPEAL";
      counterparty_party_id?: string | null;
      basis?: ("CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY") | null;
      amount_usd?: number | null;
      variant?: "FULL" | "CAPPED" | "SETTLEMENT" | null;
    }[];
  };
  feasible: boolean;
  /**
   * Hard constraints that remove this option (empty when feasible).
   */
  eliminations: {
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
   * Soft constraints: kept, but they lower confidence or require approval.
   */
  flags: (
    | "LOW_CONFIDENCE"
    | "INVENTORY_STALE"
    | "INSUFFICIENT_EVIDENCE"
    | "MODEL_EXTRAPOLATING"
    | "CONTRACT_CONSENT_REQUIRED"
    | "PROXY_AIR_ONLY"
  )[];
  /**
   * Latest time the option can still be executed, including the approval buffer when decision rights require approval.
   */
  expires_at: string;
  outcome: {
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
  };
  score: {
    /**
     * US dollars, 2-decimal precision.
     */
    risk_adjusted_usd: number;
    /**
     * null for infeasible options.
     */
    rank: number | null;
    dominated_by: string[];
    objective_version: string;
  };
  provenance: {
    engine_version: string;
    inputs_hash: string;
    seed: number;
    param_versions: ParamVersions;
    pack_id: string;
  };
  /**
   * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
   */
  evidence_id: string;
}
/**
 * Versions of every governed input a computation used.
 */
export interface ParamVersions {
  policy: string;
  semantic: string;
  engine: string;
  products?: string;
  contracts?: string;
  prices?: string;
  cost_rates?: string;
  lanes?: string;
  [k: string]: string;
}
