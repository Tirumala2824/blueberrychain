/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Sealed snapshot of every fact a decision used, as knowable at as_of (data received <= as_of). Immutable once sealed; content_hash is recorded in the ledger. REPLAY_EVIDENCE rebuilds it and must reproduce the hash.
 */
export interface EvidencePack {
  pack_id: string;
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  revision: number;
  as_of: string;
  sealed_at: string;
  param_versions: ParamVersions;
  shipment: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    shipment_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    carrier_party_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    reefer_device_id?: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    origin_site_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    destination_site_id: string;
    bol_setpoint_c?: number | null;
    state_at_as_of: "PLANNED" | "LOADING" | "IN_TRANSIT" | "AT_DOCK" | "DELIVERED" | "REJECTED";
    next_junction_site_id?: string | null;
    eta_p50_at: string;
    eta_p90_at: string;
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id?: string;
  };
  /**
   * @minItems 1
   */
  lots: [
    {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      product_id: string;
      organic: boolean;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
      /**
       * US dollars, 2-decimal precision.
       */
      planned_value_usd: number;
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      grower_party_id: string;
      harvest_at: string;
      primary_probe_device_id?: string | null;
      /**
       * True when no pulp probe exists and reefer air is used as a flagged proxy.
       */
      proxy_air_only: boolean;
      /**
       * Canonical metric values for this lot (frozen). Must include REMAINING_SHELF_LIFE_DAYS, MONITORING_COVERAGE_PCT, TEMPERATURE_COMPLIANCE_PCT, VALUE_AT_RISK_USD.
       */
      values: Value[];
      custody_exposure: {
        /**
         * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
         */
        holder_party_id: string;
        holder_type: "GROWER" | "PACKHOUSE" | "CARRIER" | "DC" | "CUSTOMER" | "PROCESSOR";
        excess_life_share: number | null;
        thermal_exposure_deg_h: number;
        breach_min: number;
        /**
         * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
         */
        evidence_id?: string;
      }[];
    },
    ...{
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      product_id: string;
      organic: boolean;
      /**
       * Kilograms, 3-decimal precision.
       */
      kg: number;
      /**
       * US dollars, 2-decimal precision.
       */
      planned_value_usd: number;
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      grower_party_id: string;
      harvest_at: string;
      primary_probe_device_id?: string | null;
      /**
       * True when no pulp probe exists and reefer air is used as a flagged proxy.
       */
      proxy_air_only: boolean;
      /**
       * Canonical metric values for this lot (frozen). Must include REMAINING_SHELF_LIFE_DAYS, MONITORING_COVERAGE_PCT, TEMPERATURE_COMPLIANCE_PCT, VALUE_AT_RISK_USD.
       */
      values: Value[];
      custody_exposure: {
        /**
         * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
         */
        holder_party_id: string;
        holder_type: "GROWER" | "PACKHOUSE" | "CARRIER" | "DC" | "CUSTOMER" | "PROCESSOR";
        excess_life_share: number | null;
        thermal_exposure_deg_h: number;
        breach_min: number;
        /**
         * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
         */
        evidence_id?: string;
      }[];
    }[]
  ];
  custody_timeline: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    party_id: string;
    holder_type: "GROWER" | "PACKHOUSE" | "CARRIER" | "DC" | "CUSTOMER" | "PROCESSOR";
    site_id?: string | null;
    from_at: string;
    to_at?: string | null;
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id?: string;
  }[];
  affected_order_lines: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    order_line_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    customer_party_id: string;
    customer_tier: "A" | "B" | "C";
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    product_id: string;
    organic_required?: boolean;
    /**
     * Kilograms, 3-decimal precision.
     */
    kg: number;
    /**
     * US dollars per kg, 4-decimal precision.
     */
    price_usd_per_kg: number;
    requested_delivery_at: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    ship_to_site_id: string;
    min_shelf_life_days_at_receipt: number;
    max_arrival_pulp_c?: number | null;
    assigned_lot_id?: string | null;
    penalty_terms?: {
      otif_penalty_pct?: number;
      /**
       * US dollars per kg, 4-decimal precision.
       */
      rejection_penalty_usd_per_kg?: number;
      /**
       * US dollars, 2-decimal precision.
       */
      late_penalty_usd_per_day?: number;
    };
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id?: string;
  }[];
  /**
   * Replacement supply (quality-adjusted ATP) usable for affected lines.
   */
  candidate_inventory: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    lot_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    site_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    product_id: string;
    organic: boolean;
    /**
     * Kilograms, 3-decimal precision.
     */
    kg_available: number;
    remaining_shelf_life_days: number;
    snapshot_at: string;
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id?: string;
  }[];
  /**
   * Sites the generator may route to - agents cannot add destinations outside this list.
   */
  candidate_destinations: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    site_id: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    party_id: string;
    channel: "CONTRACT" | "REGIONAL" | "FOODSERVICE" | "PROCESSOR" | "DONATION";
    customer_tier?: ("A" | "B" | "C") | null;
    /**
     * US dollars per kg, 4-decimal precision.
     */
    price_usd_per_kg: number;
    transit_h_p50: number;
    transit_h_p90: number;
    min_shelf_life_days_at_receipt: number;
    capacity_kg?: number | null;
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id?: string;
  }[];
  documents: {
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
    sha256: string;
    received_at: string;
    claims: {
      claim_key: string;
      value: number | string | boolean | null;
      unit?: string | null;
      claimed_at?: string | null;
      consistency?: {
        verdict: "CONSISTENT" | "CONFLICT" | "UNVERIFIABLE";
        sensor_value?: number | null;
        delta?: number | null;
        rule_id?: string | null;
      };
      /**
       * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
       */
      evidence_id?: string;
    }[];
  }[];
  data_gaps: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    device_id: string;
    from_at: string;
    to_at: string;
    minutes: number;
  }[];
  deadline_inputs: {
    /**
     * When each kind of option stops being feasible (e.g. re-route junction passed).
     */
    windows: {
      kind: "CONTINUE" | "EXPEDITE" | "REROUTE" | "DOWNGRADE" | "INSPECT" | "HOLD" | "DISPOSE";
      site_id?: string | null;
      closes_at: string;
    }[];
  };
  content_hash: string;
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
/**
 * A self-describing number handed to an agent or stored as decision evidence.
 */
export interface Value {
  name: string;
  value: number | string | boolean | null;
  unit: string;
  grain: string;
  as_of: string;
  data_age_min?: number | null;
  freshness: "OK" | "STALE";
  metric_version: string;
  /**
   * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
   */
  evidence_id: string;
}
