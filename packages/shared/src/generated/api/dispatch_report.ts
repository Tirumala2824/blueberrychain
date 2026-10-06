/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * The REPORT argument of API.ACK_MUTATION(mutation_id, report): what the dispatcher observed at the target. VERIFIED = observed_after matches expected_after; ABORTED_PRECONDITION = observed_before did not match expected_before (nothing was written); RETRY = the target's state is unknown after a timeout (the dispatcher never resends blind).
 */
export interface DispatchReport {
  outcome: "VERIFIED" | "FAILED" | "ABORTED_PRECONDITION" | "RETRY";
  dispatcher_id: string;
  attempt: number;
  external_ref: string | null;
  observed_before: {} | null;
  observed_after: {} | null;
  target_status: "UNKNOWN" | "APPLIED" | "FAILED" | null;
  target_response: unknown;
  error: Error | null;
  started_at: string;
  finished_at: string;
}
export interface Error {
  code: string;
  path?: string;
  message: string;
}
