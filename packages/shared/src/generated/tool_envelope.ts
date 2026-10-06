/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * Every agent tool returns this envelope. Values are self-describing; every returned item carries an evidence_id that is logged in DECISION.TOOL_CALLS so submissions can only cite evidence the run actually saw.
 */
export interface AgentToolResponseEnvelope {
  status: "OK" | "PARTIAL" | "STALE" | "INVALID" | "DENIED" | "ERROR";
  tool: string;
  tool_version: string;
  run_id: string;
  case_id?: string | null;
  as_of?: string | null;
  call_seq: number;
  data: {};
  values: Value[];
  evidence_ids: string[];
  warnings: string[];
  errors: Error[];
  result_hash: string;
}
/**
 * A self-describing number handed to an agent or stored as decision evidence.
 */
export interface Value {
  name: string;
  value: number | string | boolean | null;
  unit: string;
  grain: string;
  as_of: string;
  data_age_min?: number | null;
  freshness: "OK" | "STALE";
  metric_version: string;
  /**
   * Provenance handle minted by a tool for every item it returns. Agents may cite only evidence returned to the same run or present in the case's evidence pack.
   */
  evidence_id: string;
}
export interface Error {
  code: string;
  path?: string;
  message: string;
}
