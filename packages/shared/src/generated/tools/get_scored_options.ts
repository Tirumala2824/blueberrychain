/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * R5 - the scored option set for the current decision point.
 */
export interface GET_SCORED_OPTIONSInput {
  run_id: string;
  case_id: string;
  include_infeasible: boolean;
  include_variants: boolean;
}
