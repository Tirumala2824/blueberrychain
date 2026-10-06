/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * R1 - situation for the current decision point (frozen pack values, custody timeline, affected orders, escalation reasons, deadline, latest finding, D2 responses).
 */
export interface GET_CASE_CONTEXTInput {
  run_id: string;
  case_id: string;
  /**
   * @minItems 1
   */
  sections: [
    "HEADER" | "LOTS" | "CUSTODY" | "ORDERS" | "FINDING" | "ESCALATION" | "RESPONSES" | "ALL",
    ...("HEADER" | "LOTS" | "CUSTODY" | "ORDERS" | "FINDING" | "ESCALATION" | "RESPONSES" | "ALL")[]
  ];
}
