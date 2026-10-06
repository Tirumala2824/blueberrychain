/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * G1 - dry-run of C1-C3 with the same validator code path; writes nothing.
 */
export type VALIDATE_SUBMISSIONInput = {
  [k: string]: unknown;
} & {
  run_id: string;
  case_id: string;
  submission_type: "FINDING" | "RECOMMENDATION" | "CLAIM_RECOMMENDATION";
  payload: {};
};
