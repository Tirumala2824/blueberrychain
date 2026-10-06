/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.CLAIM_WORK(worker_id, lease_s), called by the engine. Leases the next case that needs a step (expired leases can be reclaimed) and says what the step is. Snowflake's state machine decides; the engine only executes the step.
 */
export type CLAIM_WORKResult =
  | APIRefusal
  | {
      status: "OK";
      work: null | {
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
        step: "ADVANCE" | "AGENT";
        agent: ("EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY" | "EVIDENCE_AUDITOR") | null;
        /**
         * The artifact to audit when agent = EVIDENCE_AUDITOR.
         */
        artifact_id: string | null;
        attempt: number;
        lease_owner: string;
        lease_until: string;
      };
    };

/**
 * What every API procedure returns when it refuses a call: INVALID (malformed input) or DENIED (governance said no). Matches the existing procedures ({status, errors}); `code` is a stable machine-readable reason for new procedures (see docs/frontend-spec.md, denial codes).
 */
export interface APIRefusal {
  status: "INVALID" | "DENIED";
  /**
   * @maxItems 50
   */
  errors: string[];
  code?: string;
}
