/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * @maxItems 100
 */
export type Citations = string[];
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
export type Persona = "quality" | "sales" | "finance" | "auditor" | "govadmin";

/**
 * A recorded walk through one case, replayed by the control tower's fixture mode (BBC_API_MODE=fixture) with no business logic: frames of read-model snapshots, and recorded responses (per persona) that may move the tape to another frame. A call with no recording is refused (FIXTURE_NO_RECORDING), and a read with no recording behaves as not granted to that identity. Synthetic tapes use the design's illustrative numbers; recorded tapes come from a live BBC_OS. Nothing in a tape is a decision.
 */
export interface FixtureTape {
  tape: string;
  title: string;
  provenance: string;
  description: string;
  personas: {
    [k: string]: {
      user: string;
      role: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
    };
  };
  /**
   * @minItems 1
   * @maxItems 100
   */
  frames: [
    {
      label: string;
      inbox: {
        [k: string]: CaseInboxRow[];
      };
      cases: {
        [k: string]: {
          view: CaseView;
          viewers: {
            [k: string]: Viewer;
          };
        };
      };
    },
    ...{
      label: string;
      inbox: {
        [k: string]: CaseInboxRow[];
      };
      cases: {
        [k: string]: {
          view: CaseView;
          viewers: {
            [k: string]: Viewer;
          };
        };
      };
    }[]
  ];
  /**
   * @maxItems 500
   */
  responses: {
    call:
      | "ACTIVE_POLICY"
      | "DECIDE_APPROVAL"
      | "REVERSE_DECISION"
      | "EMERGENCY_STOP"
      | "VERIFY_LEDGER"
      | "REPLAY_EVIDENCE"
      | "EXPORT_EVIDENCE_PACK";
    persona: Persona;
    /**
     * @minItems 1
     */
    at_frames: [number, ...number[]];
    /**
     * Argument name -> value; every listed argument must deep-equal the call's.
     */
    match: {};
    /**
     * Validated against the call's result schema by the tape tests.
     */
    result: {};
    advance_to_frame: number | null;
  }[];
  /**
   * @maxItems 100
   */
  analyst: {
    question: string;
    answer: AnalystAnswer;
  }[];
  agent_traces: {
    /**
     * @maxItems 2000
     */
    [k: string]: {
      delay_ms: number;
      event: AgentTraceEvent;
    }[];
  };
}
/**
 * One row of the view API.V_CASE_INBOX (column names lower-cased), read by persona roles. A projection of DECISION.CASES, CASE_LOTS, the open APPROVALS, the ACTIVE RECOMMENDATIONS row, the latest POLICY_EVALUATIONS row and MAX(LEDGER.ENTRIES.seq) for the case. Snowflake computes inbox_rank and awaiting_me; the app only orders and renders.
 */
export interface CaseInboxRow {
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  state:
    | "OPEN"
    | "ASSESSED"
    | "FORENSICS_PENDING"
    | "FINDING_RECORDED"
    | "OPTIONS_SCORED"
    | "STRATEGY_PENDING"
    | "CLAIMS_PENDING"
    | "RECOMMENDED"
    | "AUDIT_PENDING"
    | "AUDITED"
    | "AUTO_APPROVED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "ALTERNATIVE_CHOSEN"
    | "REJECTED"
    | "DENIED"
    | "SHADOW_RECORDED"
    | "EXECUTING"
    | "EXECUTED"
    | "EXECUTION_FAILED"
    | "FALLBACK_EXECUTED"
    | "AWAITING_OUTCOME"
    | "OUTCOME_RECORDED"
    | "CLAIM_OPEN"
    | "SETTLED"
    | "ABSORBED"
    | "SEALED";
  state_version: number;
  /**
   * state_version || ':' || last ledger seq of the case. Changes whenever anything about the case changes.
   */
  change_token: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  shipment_id: string | null;
  /**
   * @minItems 1
   */
  lot_ids: [string, ...string[]];
  opened_at: string;
  onset_at: string;
  deadline_ts: string | null;
  /**
   * Earliest due_at of the case's REQUESTED approvals.
   */
  due_at: string | null;
  /**
   * When the deadline watchdog will execute the safe fallback if nothing is executed first.
   */
  fallback_at: string | null;
  value_at_risk_usd: number | null;
  decided_by: ("RULE" | "AGENT" | "HUMAN" | "FALLBACK") | null;
  evaluation_outcome: ("AUTO" | "APPROVE" | "HUMAN_INITIATE" | "OBSERVE_ONLY" | "DENY") | null;
  autonomy_level: number | null;
  /**
   * Required roles of the case's REQUESTED approvals.
   */
  awaiting_roles: ("BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN")[];
  /**
   * True when a REQUESTED approval needs a role active in the caller's session (IS_ROLE_IN_SESSION) and the caller is not its proposer.
   */
  awaiting_me: boolean;
  needs_reassessment: boolean;
  /**
   * Position in the inbox: open cases by decision deadline and value at risk, computed in the view.
   */
  inbox_rank: number;
  is_open: boolean;
  sealed_at: string | null;
  policy_version: string;
  provenance: "LIVE" | "SIMULATION_BACKFILL";
  updated_at: string;
}
/**
 * The snapshot; its viewer is replaced per persona.
 */
export interface CaseView {
  view_version: "1";
  generated_at: string;
  /**
   * state_version || ':' || last ledger seq of the case.
   */
  change_token: string;
  viewer: Viewer;
  case: Case;
  event: {
    /**
     * DECISION.CASES.detection: the CASE_OPENED payload written by OPEN_CASES (lots, onset, holder, detection rule).
     */
    detection: {};
  };
  analysis: {
    /**
     * EVIDENCE.EVIDENCE_PACKS.pack for CASES.current_pack_id.
     */
    pack: EvidencePack | null;
    /**
     * @maxItems 50
     */
    packs: {
      pack_id: string;
      /**
       * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
       */
      decision_point: "D1" | "D2";
      revision: number;
      as_of: string;
      sealed_at: string;
      content_hash: string;
    }[];
    /**
     * @maxItems 50
     */
    thermal: LotThermal[];
    /**
     * @maxItems 50
     */
    findings: FindingRow[];
  };
  /**
   * DECISION.OPTIONS.option for the current decision point's latest option set, including agent variants and eliminated options.
   *
   * @maxItems 100
   */
  options: Option[];
  decision: {
    /**
     * @maxItems 50
     */
    recommendations: RecommendationRow[];
  };
  governance: {
    policy: {
      policy_version: string;
      kill_switches: KillSwitches;
    };
    /**
     * @maxItems 50
     */
    evaluations: EvaluationRow[];
    /**
     * @maxItems 50
     */
    approvals: ApprovalRow[];
    fallback: {
      option_id: string;
      label: string;
      /**
       * When the deadline watchdog (DECISION.T_DEADLINE_WATCHDOG) executes this option if nothing has executed.
       */
      runs_at: string;
    } | null;
  };
  execution: {
    /**
     * @maxItems 50
     */
    plans: PlanRow[];
    /**
     * @maxItems 100
     */
    mutations: MutationRow[];
  };
  outcome: {
    /**
     * @maxItems 50
     */
    lots: OutcomeRow[];
    /**
     * @maxItems 50
     */
    claims: ClaimRow[];
  };
  agents: {
    /**
     * @maxItems 50
     */
    runs: AgentRunRow[];
  };
  evidence: {
    sealed: boolean;
    sealed_at: string | null;
    ledger: {
      /**
       * LEDGER.ENTRIES where case_id = the case, ascending seq (payload omitted; payload_hash kept).
       *
       * @maxItems 1000
       */
      entries: LedgerEntry[];
      first_seq: number | null;
      last_seq: number | null;
      truncated: boolean;
    };
  };
}
/**
 * Who is looking (CURRENT_USER(), CURRENT_ROLE()) and what Snowflake says they may do now.
 */
export interface Viewer {
  user: string;
  role: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
  /**
   * @maxItems 50
   */
  available_actions: AvailableAction[];
}
/**
 * One action the viewer could take. enabled = false carries the governance reason (wrong role, proposer cannot approve, approval stale, deadline passed, ...). Advisory only: the procedure re-checks everything.
 */
export interface AvailableAction {
  action:
    | "DECIDE_APPROVAL"
    | "REVERSE_DECISION"
    | "VERIFY_LEDGER"
    | "REPLAY_EVIDENCE"
    | "EXPORT_EVIDENCE_PACK"
    | "EMERGENCY_STOP";
  enabled: boolean;
  disabled_reason: string | null;
  approval_id?: string;
  required_role?: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
  verdicts?: ("APPROVE" | "ALTERNATIVE" | "REJECT")[];
  /**
   * Scored, feasible, unexpired options an approver may choose instead (CHOOSE_ALTERNATIVE).
   */
  choosable_option_ids?: string[];
  reason_required_for?: ("APPROVE" | "ALTERNATIVE" | "REJECT")[];
  rec_id?: string;
  pack_ids?: string[];
  due_at?: string;
}
/**
 * DECISION.CASES (lease columns omitted) + DECISION.CASE_LOTS.
 */
export interface Case {
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  state:
    | "OPEN"
    | "ASSESSED"
    | "FORENSICS_PENDING"
    | "FINDING_RECORDED"
    | "OPTIONS_SCORED"
    | "STRATEGY_PENDING"
    | "CLAIMS_PENDING"
    | "RECOMMENDED"
    | "AUDIT_PENDING"
    | "AUDITED"
    | "AUTO_APPROVED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "ALTERNATIVE_CHOSEN"
    | "REJECTED"
    | "DENIED"
    | "SHADOW_RECORDED"
    | "EXECUTING"
    | "EXECUTED"
    | "EXECUTION_FAILED"
    | "FALLBACK_EXECUTED"
    | "AWAITING_OUTCOME"
    | "OUTCOME_RECORDED"
    | "CLAIM_OPEN"
    | "SETTLED"
    | "ABSORBED"
    | "SEALED";
  state_version: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  episode_key: string;
  shipment_id: string | null;
  onset_at: string;
  detected_at: string;
  opened_at: string;
  opened_by: string;
  holder_party_id_at_onset: string | null;
  holder_type_at_onset: ("GROWER" | "PACKHOUSE" | "CARRIER" | "DC" | "CUSTOMER" | "PROCESSOR") | null;
  policy_version: string;
  deadline_ts: string | null;
  value_at_risk_usd: number | null;
  current_pack_id: string | null;
  current_rec_id: string | null;
  current_brief_hash: string | null;
  needs_reassessment: boolean;
  provenance: "LIVE" | "SIMULATION_BACKFILL";
  updated_at: string;
  /**
   * @minItems 1
   * @maxItems 50
   */
  lots: [
    {
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      added_at: string;
      onset_at: string;
      detected_at: string;
      breach_min_at_detection: number;
      max_pulp_c: number | null;
      holder_party_id_at_onset: string | null;
    },
    ...{
      /**
       * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
       */
      lot_id: string;
      added_at: string;
      onset_at: string;
      detected_at: string;
      breach_min_at_detection: number;
      max_pulp_c: number | null;
      holder_party_id_at_onset: string | null;
    }[]
  ];
}
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
     * The reefer unit's latest reading: is a fault still active?
     */
    reefer_state?: null | {
      as_of: string;
      mode?: string | null;
      alarms: string[];
      supply_air_c?: number | null;
      return_air_c?: number | null;
      setpoint_c?: number | null;
      ambient_c?: number | null;
    };
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
       * Pulp temperature at the last reading: where the outcome simulation starts.
       */
      last_pulp_c?: number | null;
      last_reading_at?: string | null;
      /**
       * A GOV.HARD_LIMITS limit was exceeded (the assessment computes it): only hold, inspect or dispose remain.
       */
      food_safety_flag?: boolean;
      /**
       * Whether the shelf-life model is valid for this lot's thermal history.
       */
      model_validity?: "IN_RANGE" | "EXTRAPOLATING" | "UNCALIBRATED";
      /**
       * Standard deviation of the remaining-shelf-life estimate (calibration, else the product prior).
       */
      sigma_days?: number;
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
       * Pulp temperature at the last reading: where the outcome simulation starts.
       */
      last_pulp_c?: number | null;
      last_reading_at?: string | null;
      /**
       * A GOV.HARD_LIMITS limit was exceeded (the assessment computes it): only hold, inspect or dispose remain.
       */
      food_safety_flag?: boolean;
      /**
       * Whether the shelf-life model is valid for this lot's thermal history.
       */
      model_validity?: "IN_RANGE" | "EXTRAPOLATING" | "UNCALIBRATED";
      /**
       * Standard deviation of the remaining-shelf-life estimate (calibration, else the product prior).
       */
      sigma_days?: number;
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
     * The receiver's maximum pulp temperature at receipt (null = none).
     */
    max_arrival_pulp_c?: number | null;
    /**
     * Incremental freight of the diversion from the current position.
     */
    freight_usd?: number | null;
    /**
     * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
     */
    evidence_id?: string;
  }[];
  /**
   * Own facilities reachable for a QC hold (the INSPECT option), with the diversion's transit and freight.
   */
  inspection_sites?: {
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    site_id: string;
    transit_h_p50: number;
    transit_h_p90: number;
    freight_usd?: number | null;
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
/**
 * OPS.LOT_THERMAL_BUCKETS for one case lot (15-minute buckets per custody holder), ascending, capped at 600 buckets; threshold from REF.PRODUCTS.
 */
export interface LotThermal {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  threshold_c: number;
  as_of: string | null;
  truncated: boolean;
  /**
   * @maxItems 600
   */
  buckets: {
    start: string;
    /**
     * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
     */
    holder_party_id: string;
    holder_type: ("GROWER" | "PACKHOUSE" | "CARRIER" | "DC" | "CUSTOMER" | "PROCESSOR") | null;
    readings: number;
    reading_min: number;
    breach_min: number;
    min_pulp_c: number;
    max_pulp_c: number;
    excess_h: number;
  }[];
}
/**
 * DECISION.CAUSATION_FINDINGS (validation omitted).
 */
export interface FindingRow {
  finding_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  revision: number;
  pack_id: string;
  decider_kind: "AGENT" | "RULE";
  run_id: string | null;
  status: "ACCEPTED" | "REJECTED" | "SUPERSEDED";
  /**
   * True when no agent finding exists and the deterministic attribution stands (claims stay DEFERRED).
   */
  unadjudicated: boolean;
  confidence: ("HIGH" | "MEDIUM" | "LOW") | null;
  finding: CausationFindingPayload | null;
  finding_hash: string | null;
  created_at: string;
  created_by: string;
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
  eliminations: Eliminations;
  flags: Flags;
  /**
   * Latest time the option can still be executed, including the approval buffer when decision rights require approval.
   */
  expires_at: string;
  outcome: Outcome;
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
/**
 * DECISION.RECOMMENDATIONS. audited_text is the exact text the audit verdict's span offsets index (code points).
 */
export interface RecommendationRow {
  rec_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  option_id: string;
  decided_by: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
  decider_id: string;
  run_id: string | null;
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
  status: "ACTIVE" | "SUPERSEDED" | "REJECTED";
  audit_status: "NOT_REQUIRED" | "PENDING" | "PASS" | "FAIL" | "UNVERIFIED";
  brief: DecisionBrief | null;
  brief_hash: string | null;
  /**
   * The agent's validated submission (AGENT decisions only).
   */
  submission: RecommendationPayload | ClaimRecommendationPayload | null;
  audit_verdict: AuditVerdictPayload | null;
  audited_text: string | null;
  created_at: string;
}
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
/**
 * What the Claims & Recovery agent submits through SUBMIT_CLAIM_RECOMMENDATION. Amounts come only from variant_option_id (calculator-generated). FILE_CLAIM needs a SUFFICIENT finding with confidence >= MEDIUM, all prerequisites satisfied and the filing deadline open; COUNTER / ACCEPT_OFFER must sit inside the policy settlement band.
 */
export interface ClaimRecommendationPayload {
  action:
    "CLAIM_NOTICE" | "FILE_CLAIM" | "GROWER_DEDUCTION" | "ABSORB" | "DEFER" | "ACCEPT_OFFER" | "COUNTER" | "APPEAL";
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  counterparty_id: string;
  basis: "CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY";
  /**
   * Required for FILE_CLAIM, GROWER_DEDUCTION, COUNTER and ACCEPT_OFFER; null for NOTICE / ABSORB / DEFER / APPEAL.
   */
  variant_option_id: string | null;
  prerequisites_ack: (
    "NOTICE_TIMELY" | "MITIGATION_EVIDENCED" | "SETPOINT_ON_BOL" | "CUSTODY_PROVEN" | "DOCS_COMPLETE"
  )[];
  anticipated_defenses: {
    defense:
      | "WARM_LOADING"
      | "SETPOINT_NOT_ON_BOL"
      | "SENSOR_UNRELIABLE"
      | "NO_MITIGATION"
      | "LIABILITY_CAP"
      | "LATE_NOTICE"
      | "OTHER";
    rebuttal: string;
    evidence_ids: Citations;
  }[];
  letter_draft: string;
  /**
   * Counterparty response id being answered, or empty string.
   */
  response_to: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  citations: Citations;
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
/**
 * The active policy's kill switches (GOV.PARAMETERS).
 */
export interface KillSwitches {
  autonomy_ceiling: number;
  shadow_mode: boolean;
  fallback_enabled: boolean;
  dispatch_enabled: boolean;
}
/**
 * DECISION.POLICY_EVALUATIONS; `dimensions` and `reasons` come from the evaluation VARIANT (bbc_engine.autonomy.Authorization).
 */
export interface EvaluationRow {
  eval_id: string;
  rec_id: string;
  policy_version: string;
  /**
   * Outcome of one policy evaluation (DECISION.POLICY_EVALUATIONS.outcome). Shadow is a separate flag, not an outcome.
   */
  outcome: "AUTO" | "APPROVE" | "HUMAN_INITIATE" | "OBSERVE_ONLY" | "DENY";
  autonomy_level: number;
  required_roles: ("BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN")[];
  dual_approval: boolean;
  shadow: boolean;
  matched_rules: string[];
  value_at_risk_usd: number | null;
  /**
   * @maxItems 50
   */
  reasons: string[];
  /**
   * @maxItems 50
   */
  dimensions: {
    dimension: string;
    metric: string;
    value: number | string | boolean | null;
    band: "L0" | "L1" | "L2" | "L3" | "L4" | "DUAL_APPROVAL" | "FALLBACK_ONLY";
    approver_roles: (
      "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN"
    )[];
  }[];
  created_at: string;
}
/**
 * DECISION.APPROVALS (one row per required role).
 */
export interface ApprovalRow {
  approval_id: string;
  eval_id: string;
  rec_id: string;
  required_role: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
  status: "REQUESTED" | "APPROVED" | "ALTERNATIVE_CHOSEN" | "REJECTED" | "EXPIRED" | "STALE";
  requested_at: string;
  due_at: string;
  brief_hash_at_request: string;
  proposer: string;
  decided_by: string | null;
  decided_role:
    ("BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN") | null;
  decided_at: string | null;
  chosen_option_id: string | null;
  reason: string | null;
  freshness: {
    brief_fresh: boolean;
    pack_fresh: boolean;
    checked_at: string;
  } | null;
}
/**
 * DECISION.EXECUTION_PLANS.
 */
export interface PlanRow {
  plan_id: string;
  rec_id: string;
  atomicity: "ALL_OR_NOTHING" | "BEST_EFFORT";
  status: "PLANNED" | "EXECUTING" | "DONE" | "PARTIAL" | "COMPENSATING" | "COMPENSATED" | "FAILED";
  /**
   * @maxItems 50
   */
  steps: {
    step_seq: number;
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
    mutation_id: string | null;
  }[];
  created_at: string;
  updated_at: string;
}
/**
 * DECISION.MUTATIONS key columns + intent + the gateway's record (null until the gateway has written one).
 */
export interface MutationRow {
  mutation_id: string;
  plan_id: string | null;
  step_seq: number | null;
  status:
    | "PROPOSED"
    | "VALIDATED"
    | "PENDING_APPROVAL"
    | "AUTHORIZED"
    | "REJECTED"
    | "EXPIRED"
    | "PREPARED"
    | "DISPATCHED"
    | "ACKED"
    | "VERIFIED"
    | "ABORTED_PRECONDITION"
    | "CONFLICT"
    | "FAILED"
    | "COMPENSATING"
    | "COMPENSATED"
    | "SHADOW";
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
  compensation_of: string | null;
  compensated_by: string | null;
  updated_at: string;
  intent: MutationIntent;
  record: MutationRecord | null;
}
/**
 * One step of an execution plan, as handed to DECISION.MUTATE - the only code path that changes operational state. MUTATE validates, authorizes, executes and records it (see mutation_record.json).
 */
export interface MutationIntent {
  case_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  rec_id: string;
  option_id: string;
  plan_id: string;
  step_seq: number;
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
  target_entity: {
    type: "LOT_STOCK" | "SALES_ORDER_ITEM" | "DELIVERY" | "SHIPMENT" | "CLAIM" | "VENDOR_ACCOUNT" | "CUSTOMER" | "CASE";
    id: string;
  };
  /**
   * Action-specific fields; shape is checked against GOV.ACTION_TYPES.
   */
  payload: {};
  /**
   * sha256 of case_id, decision_point, option_id, action_type, target_entity and brief_hash. Duplicates return the existing mutation.
   */
  idempotency_key: string;
  brief_hash: string;
  pack_id: string;
  /**
   * Precondition fields the dispatcher compares with the target's live state before writing.
   */
  expected_before: {};
  /**
   * Fields the dispatcher verifies after the acknowledgement.
   */
  expected_after: {};
  compensation_of: string | null;
  requested_by: {
    kind: "ENGINE" | "HUMAN" | "WATCHDOG" | "AGENT_TOOL";
    principal: string;
  };
}
/**
 * The governed record of one mutation: the nine required steps (validate, authorize, execute, before/after state, decision evidence, actor, timestamps, metric snapshot, approvals). Written by DECISION.MUTATE and the dispatcher acknowledgement; mirrored into the ledger.
 */
export interface MutationRecord {
  mutation_id: string;
  intent: MutationIntent;
  status:
    | "PROPOSED"
    | "VALIDATED"
    | "PENDING_APPROVAL"
    | "AUTHORIZED"
    | "REJECTED"
    | "EXPIRED"
    | "PREPARED"
    | "DISPATCHED"
    | "ACKED"
    | "VERIFIED"
    | "ABORTED_PRECONDITION"
    | "CONFLICT"
    | "FAILED"
    | "COMPENSATING"
    | "COMPENSATED"
    | "SHADOW";
  validation: {
    passed: boolean;
    errors: Error[];
  };
  autonomy_level: number;
  policy_eval_id: string;
  approval_ids: string[];
  /**
   * Hash of intent + policy_eval_id + approval_ids. V_DISPATCHABLE recomputes it; a row edited outside the gateway never dispatches.
   */
  authorization_hash: string | null;
  observed_before: {} | null;
  observed_after: {} | null;
  metric_snapshot: {
    frozen: Value[];
    live: Value[];
    drift: {
      name: string;
      frozen: number | null;
      live: number | null;
      delta: number | null;
      within_tolerance: boolean;
    }[];
  };
  actor_chain: {
    decider_kind: "RULE" | "AGENT" | "HUMAN" | "FALLBACK";
    decider_id: string;
    agent_run_id?: string | null;
    model?: string | null;
    spec_version?: string | null;
    executor_user: string;
    executor_role: string;
    approvers: {
      user: string;
      role: string;
      approval_id: string;
    }[];
  };
  timestamps: {
    proposed_at: string;
    evaluated_at?: string | null;
    approved_at?: string | null;
    authorized_at?: string | null;
    dispatched_at?: string | null;
    acked_at?: string | null;
    verified_at?: string | null;
    target_reported_at?: string | null;
  };
  external_ref: string | null;
  attempts: number;
  last_error: Error | null;
  compensated_by: string | null;
}
export interface Error {
  code: string;
  path?: string;
  message: string;
}
/**
 * DECISION.OUTCOMES per lot. value_protected_expost_usd = realized NRV - the default option's NRV re-scored with observed facts, computed in Snowflake.
 */
export interface OutcomeRow {
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  lot_id: string;
  outcome_status: "OBSERVED" | "UNKNOWN" | "PROVISIONAL";
  accepted_at_receipt: boolean | null;
  realized_nrv_usd: number | null;
  predicted_nrv_usd: number | null;
  default_nrv_usd: number | null;
  value_protected_expost_usd: number | null;
  sl_prediction_error_days: number | null;
  /**
   * OUTCOMES.observed (receipt QC, actual shelf life, sale value).
   */
  observed: {};
  /**
   * OUTCOMES.predicted (the chosen option's prediction).
   */
  predicted: {};
  computed_at: string;
}
/**
 * DECISION.CLAIMS (the letter is omitted; it is in the claim recommendation).
 */
export interface ClaimRow {
  claim_id: string;
  /**
   * Identifier issued by a source system or the world config (lot, shipment, order line, party, site, product, device, contract, document).
   */
  counterparty_party_id: string;
  basis: "CARRIER_TEMPERATURE" | "GROWER_PRECOOL" | "GROWER_QUALITY";
  status: "NOTICE_SENT" | "FILED" | "RESPONDED" | "SETTLED" | "DENIED" | "ABSORBED" | "WITHDRAWN";
  amount_usd: number | null;
  paid_usd: number | null;
  notice_sent_at: string | null;
  filed_at: string | null;
  filing_due_at: string | null;
  variant_option_id: string | null;
  evidence_pack_id: string | null;
  updated_at: string;
}
/**
 * DECISION.AGENT_RUNS + its DECISION.TOOL_CALLS. trace is the recorded, normalized event list (END_AGENT_RUN).
 */
export interface AgentRunRow {
  run_id: string;
  /**
   * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
   */
  decision_point: "D1" | "D2";
  agent: "EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY" | "EVIDENCE_AUDITOR";
  provider: string;
  model: string;
  spec_version: string;
  status: "STARTED" | "COMPLETED" | "FAILED" | "EXPIRED";
  call_budget: number;
  calls_used: number;
  started_at: string;
  ended_at: string | null;
  latency_ms: number | null;
  /**
   * @maxItems 2000
   */
  trace: AgentTraceEvent[];
  trace_truncated: boolean;
  /**
   * @maxItems 200
   */
  tool_calls: {
    call_seq: number;
    tool: string;
    status: string;
    latency_ms: number | null;
    /**
     * @maxItems 500
     */
    evidence_ids: string[];
    args_hash: string;
    result_hash: string | null;
    called_at: string;
  }[];
}
/**
 * One normalized event of a Cortex Agent run, as the engine parsed it from the agent's SSE stream. Streamed live to the control tower (unrecorded) and recorded through API.END_AGENT_RUN. Agent text is untrusted output: shown, never executed.
 */
export interface AgentTraceEvent {
  run_id: string;
  seq: number;
  at: string;
  kind: "STATUS" | "THINKING" | "TEXT" | "TOOL_USE" | "TOOL_RESULT" | "ERROR" | "DONE" | "OTHER";
  text?: string;
  tool?: {
    name: string;
    tool_use_id: string;
  };
  tool_result?: {
    tool_use_id: string;
    status: string;
    /**
     * @maxItems 500
     */
    evidence_ids: string[];
  };
  error?: Error;
  /**
   * The provider's SSE event name, kept for OTHER events.
   */
  raw_type?: string;
}
export interface LedgerEntry {
  seq: number;
  ts: string;
  entry_type: string;
  actor: string;
  record_ref: string;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
}
/**
 * A governed metric question answered by Cortex Analyst over the semantic view, produced by the control tower: the SQL Analyst generated and the rows that SQL returned when run under the persona's own role. Numbers come only from `rows`; `interpretation` is Analyst's untrusted restatement. Never decision evidence: it carries no citations and cannot feed an approval.
 */
export interface AnalystAnswer {
  question: string;
  semantic_view: string;
  interpretation: string | null;
  sql: string | null;
  executed_as: {
    user: string;
    role: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
  } | null;
  /**
   * @maxItems 100
   */
  columns: {
    name: string;
    type: string;
  }[];
  /**
   * @maxItems 1000
   */
  rows: (string | number | boolean | null)[][];
  row_count: number;
  truncated: boolean;
  request_id: string | null;
  /**
   * @maxItems 50
   */
  warnings: string[];
  /**
   * @maxItems 50
   */
  suggestions: string[];
  executed_at: string;
}
