/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * The ACK argument of API.ACK_MUTATION(mutation_id, attempt, ack): what the dispatcher observed at the target. Snowflake decides the outcome itself: an error with code PRECONDITION, 409 or 412 -> ABORTED_PRECONDITION; any other error -> FAILED; observed_before differing from expected_before -> ABORTED_PRECONDITION; observed_after missing or differing from expected_after -> FAILED; otherwise VERIFIED. When the outcome is unknown (timeout, no answer), the dispatcher does not ACK.
 */
export interface MutationACK {
  observed_before: {} | null;
  observed_after: {} | null;
  error: {
    code: string;
    message: string;
  } | null;
  external_ref: string | null;
  dispatched_at: string | null;
  target_reported_at: string | null;
}
