/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.START_AGENT_RUN(case_id, agent, decision_point, provider, model), called by the engine. Opens a case-scoped, budgeted, expiring run (the capability every agent tool checks) and returns the exact message to send, so the engine holds no prompts.
 */
export type START_AGENT_RUNResult =
  | APIRefusal
  | {
      status: "OK";
      run_id: string;
      case_id: string;
      /**
       * D1 = recovery (hours); D2 = settlement (after the salvage outcome is known).
       */
      decision_point: "D1" | "D2";
      agent: "EXCURSION_FORENSICS" | "RECOVERY_STRATEGIST" | "CLAIMS_RECOVERY" | "EVIDENCE_AUDITOR";
      agent_fqn: string;
      provider: string;
      model: string;
      spec_version: string;
      /**
       * @minItems 1
       */
      tool_allowlist: [string, ...string[]];
      call_budget: number;
      expires_at: string;
      message: string;
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
