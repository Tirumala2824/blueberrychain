/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A2 - structurally similar sealed cases (sealed before the pack as_of) with decisions and outcomes. Structured retrieval, not RAG.
 */
export interface GET_PRECEDENTSInput {
  run_id: string;
  case_id: string;
  focus: "DISPOSITION" | "CAUSATION" | "CLAIM";
  k: number;
}
