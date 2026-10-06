/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.NEXT_ACTIONS(dispatcher_id, max_actions, lease_s) (83_gateway.sql): lease AUTHORIZED mutations (they become PREPARED). STOPPED while an emergency stop is in force. Each intent is the full stored mutation intent, including its idempotency_key.
 */
export type NEXT_ACTIONSResult =
  | APIRefusal
  | {
      status: "OK" | "STOPPED";
      /**
       * @maxItems 100
       */
      actions: {
        mutation_id: string;
        attempt: number;
        intent: MutationIntent;
      }[];
    };

/**
 * What an API procedure returns when it refuses a call: INVALID (malformed input or a call that doesn't apply) or DENIED (governance said no). `errors` are strings or {code, message}; procedures may add context keys (case_id, state, steps).
 */
export interface APIRefusal {
  status: "INVALID" | "DENIED";
  /**
   * @maxItems 50
   */
  errors: (
    | string
    | {
        code: string;
        message: string;
        path?: string;
        [k: string]: unknown;
      }
  )[];
  code?: string;
  [k: string]: unknown;
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
