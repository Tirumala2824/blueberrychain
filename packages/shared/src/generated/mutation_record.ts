/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

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
export interface Error {
  code: string;
  path?: string;
  message: string;
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
