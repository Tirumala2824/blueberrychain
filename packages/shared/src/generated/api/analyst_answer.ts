/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * A governed metric question answered by Cortex Analyst over the semantic view, produced by the control tower: the SQL Analyst generated and the rows that SQL returned when run under the persona's own role. Numbers come only from `rows`; `interpretation` is Analyst's untrusted restatement. Never decision evidence: it carries no citations and cannot feed an approval.
 */
export interface AnalystAnswer {
  question: string;
  semantic_view: string;
  interpretation: string | null;
  sql: string | null;
  executed_as: {
    user: string;
    role: "BBC_QUALITY_MGR" | "BBC_SALES_MGR" | "BBC_FINANCE_MGR" | "BBC_AUDITOR" | "BBC_GOVERNANCE_ADMIN";
  } | null;
  /**
   * @maxItems 100
   */
  columns: {
    name: string;
    type: string;
  }[];
  /**
   * @maxItems 1000
   */
  rows: (string | number | boolean | null)[][];
  row_count: number;
  truncated: boolean;
  request_id: string | null;
  /**
   * @maxItems 50
   */
  warnings: string[];
  /**
   * @maxItems 50
   */
  suggestions: string[];
  executed_at: string;
}
