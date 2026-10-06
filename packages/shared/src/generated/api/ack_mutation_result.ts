/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * API.ACK_MUTATION(mutation_id, attempt, ack) (83_gateway.sql): Snowflake records the observations, decides the mutation's status, advances the plan and the case, and writes the ledger. An ACK for a mutation that is already finished replays its status.
 */
export type ACK_MUTATIONResult =
  | APIRefusal
  | {
      status: "OK";
      mutation_id: string;
      mutation_status:
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
      /**
       * @maxItems 50
       */
      errors?: {
        code: string;
        message: string;
        [k: string]: unknown;
      }[];
      ledger_seq?: number;
      plan?: "DONE" | "COMPENSATING" | "PARTIAL" | "EXECUTING" | null;
      replayed?: boolean;
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
