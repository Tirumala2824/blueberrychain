/**
 * Every Snowflake interface the application layer may use, and nothing else.
 *
 * This table is the only place in the app that holds SQL. Each entry is a fixed
 * statement with bind placeholders: a CALL of an API procedure, a SELECT from an API
 * view, or a read the role is already granted. No entry mutates a table; every write
 * goes through a governed procedure that enforces identity, roles and policy itself.
 *
 * `delivers` names the work package (docs/design/implementation-plan.md, Phase 14) that
 * creates the interface in Snowflake; `exists` says whether the repo's DDL has it today.
 */

export type ServiceRole = "BBC_ENGINE" | "BBC_AGENT_RUNTIME";
export type PersonaRole =
  | "BBC_QUALITY_MGR"
  | "BBC_SALES_MGR"
  | "BBC_FINANCE_MGR"
  | "BBC_AUDITOR"
  | "BBC_GOVERNANCE_ADMIN";
export type CallerRole = PersonaRole | ServiceRole;

export interface InterfaceSpec {
  readonly kind: "procedure" | "view" | "query" | "rest";
  /** Fixed SQL (or REST path) with `?` binds in `params` order. */
  readonly statement: string;
  readonly params: readonly string[];
  readonly callers: readonly CallerRole[];
  /** Contract the result must satisfy (per row for views). */
  readonly resultSchema: string | null;
  readonly delivers: string;
  readonly exists: boolean;
  readonly writes: boolean;
}

const MANAGERS = ["BBC_QUALITY_MGR", "BBC_SALES_MGR", "BBC_FINANCE_MGR"] as const;
const READERS = [...MANAGERS, "BBC_AUDITOR", "BBC_GOVERNANCE_ADMIN"] as const;

export const INTERFACES = {
  // ---- identity -------------------------------------------------------------------
  WHOAMI: {
    kind: "query",
    statement: "SELECT CURRENT_USER() AS USER_NAME, CURRENT_ROLE() AS ROLE_NAME",
    params: [],
    callers: [...READERS, "BBC_ENGINE"],
    resultSchema: null,
    delivers: "WP1 (users and PATs)",
    exists: true,
    writes: false,
  },
  // ---- persona read model ---------------------------------------------------------
  V_CASE_INBOX: {
    kind: "view",
    statement: "SELECT * FROM BBC_OS.API.V_CASE_INBOX ORDER BY INBOX_RANK",
    params: [],
    callers: READERS,
    resultSchema: "api/inbox_row.json",
    delivers: "plan 8.3 (requested in WP6b)",
    exists: false,
    writes: false,
  },
  GET_CASE_VIEW: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.GET_CASE_VIEW(?)",
    params: ["case_id"],
    callers: READERS,
    resultSchema: "api/case_view.json",
    delivers: "plan 8.3 (requested in WP6b)",
    exists: false,
    writes: false,
  },
  ACTIVE_POLICY: {
    kind: "query",
    statement:
      "SELECT POLICY_VERSION, STATUS, CONTENT_HASH, DESCRIPTION, DRAFTED_BY, DRAFTED_AT, ACTIVATED_BY, ACTIVATED_AT, " +
      "ACTIVATION_REASON, DOCUMENT FROM BBC_OS.GOV.POLICY_VERSIONS WHERE STATUS = 'ACTIVE'",
    params: [],
    callers: ["BBC_GOVERNANCE_ADMIN"],
    resultSchema: "api/active_policy.json",
    delivers: "WP2 (GOV tables; SELECT granted to BBC_GOVERNANCE_ADMIN)",
    exists: true,
    writes: false,
  },
  // ---- persona governed actions ---------------------------------------------------
  DECIDE_APPROVAL: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.DECIDE_APPROVAL(?, ?, ?, ?)",
    params: ["approval_id", "verdict", "chosen_option_id", "reason"],
    callers: MANAGERS,
    resultSchema: "api/decide_approval_result.json",
    delivers: "WP7a (snowflake/modules/83_gateway.sql)",
    exists: true,
    writes: true,
  },
  REVERSE_DECISION: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.REVERSE_DECISION(?, ?)",
    params: ["rec_id", "reason"],
    callers: MANAGERS,
    resultSchema: "api/reverse_decision_result.json",
    delivers: "WP7b (plan 8.3; not in 84_outcome_audit.sql yet)",
    exists: false,
    writes: true,
  },
  EMERGENCY_STOP: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.EMERGENCY_STOP(?)",
    params: ["reason"],
    callers: ["BBC_GOVERNANCE_ADMIN"],
    resultSchema: "api/emergency_stop_result.json",
    delivers: "WP7a (snowflake/modules/83_gateway.sql)",
    exists: true,
    writes: true,
  },
  // ---- proof ------------------------------------------------------------------------
  VERIFY_LEDGER: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.VERIFY_LEDGER(?)",
    params: ["ledger_table"],
    callers: ["BBC_AUDITOR"],
    resultSchema: "api/verify_ledger_result.json",
    delivers: "WP7b (snowflake/modules/84_outcome_audit.sql)",
    exists: true,
    writes: false,
  },
  REPLAY_EVIDENCE: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.REPLAY_EVIDENCE(?)",
    params: ["pack_id"],
    callers: ["BBC_AUDITOR"],
    resultSchema: "api/replay_result.json",
    delivers: "WP7b (plan 8.3; not in 84_outcome_audit.sql yet)",
    exists: false,
    writes: false,
  },
  EXPORT_EVIDENCE_PACK: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.EXPORT_EVIDENCE_PACK(?)",
    params: ["case_id"],
    callers: ["BBC_AUDITOR", "BBC_FINANCE_MGR"],
    resultSchema: "api/export_result.json",
    delivers: "WP7b (plan 8.3; not in 84_outcome_audit.sql yet)",
    exists: false,
    writes: false,
  },
  // ---- engine (lifecycle worker and plan execution) ---------------------------------
  CLAIM_WORK: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.CLAIM_WORK(?, ?)",
    params: ["worker_id", "lease_s"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/claim_work_result.json",
    delivers: "WP6b (snowflake/modules/82_stages.sql)",
    exists: true,
    writes: true,
  },
  ADVANCE_CASE: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.ADVANCE_CASE(?, ?)",
    params: ["case_id", "expected_state"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/advance_case_result.json",
    delivers: "WP6b (snowflake/modules/82_stages.sql)",
    exists: true,
    writes: true,
  },
  EXECUTE_PLAN: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.EXECUTE_PLAN(?, ?)",
    params: ["case_id", "rec_id"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/execute_plan_result.json",
    delivers: "WP7a (snowflake/modules/83_gateway.sql)",
    exists: true,
    writes: true,
  },
  START_AGENT_RUN: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.START_AGENT_RUN(?, ?, ?, ?, ?)",
    params: ["case_id", "agent", "decision_point", "provider", "model"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/start_agent_run_result.json",
    delivers: "WP8a (plan 9.4)",
    exists: false,
    writes: true,
  },
  END_AGENT_RUN: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.END_AGENT_RUN(?, ?)",
    params: ["run_id", "record"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/end_agent_run_result.json",
    delivers: "WP8a (plan 9.4)",
    exists: false,
    writes: true,
  },
  // ---- engine (dispatcher) ----------------------------------------------------------
  NEXT_ACTIONS: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.NEXT_ACTIONS(?, ?, ?)",
    params: ["dispatcher_id", "max_actions", "lease_s"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/next_actions_result.json",
    delivers: "WP7a (snowflake/modules/83_gateway.sql)",
    exists: true,
    writes: true,
  },
  ACK_MUTATION: {
    kind: "procedure",
    statement: "CALL BBC_OS.API.ACK_MUTATION(?, ?, ?)",
    params: ["mutation_id", "attempt", "ack"],
    callers: ["BBC_ENGINE"],
    resultSchema: "api/ack_mutation_result.json",
    delivers: "WP7a (snowflake/modules/83_gateway.sql)",
    exists: true,
    writes: true,
  },
  // ---- agents (Cortex Agent REST, as BBC_AGENT_SVC) ---------------------------------
  AGENT_RUN: {
    kind: "rest",
    statement: "POST /api/v2/databases/BBC_OS/schemas/AGENT/agents/{agent}:run",
    params: ["agent", "messages"],
    callers: ["BBC_AGENT_RUNTIME"],
    resultSchema: null,
    delivers: "plan 10.1 (agents created; spike S8)",
    exists: false,
    writes: false,
  },
  // ---- Cortex Analyst (persona's own PAT) -------------------------------------------
  ANALYST_MESSAGE: {
    kind: "rest",
    statement: "POST /api/v2/cortex/analyst/message",
    params: ["question"],
    callers: READERS,
    resultSchema: "api/analyst_answer.json",
    delivers: "ADR-0009 grants (SEM usage + Cortex Analyst for persona roles)",
    exists: false,
    writes: false,
  },
} as const satisfies Record<string, InterfaceSpec>;

export type InterfaceName = keyof typeof INTERFACES;

/** Governed write procedures a signed-in person may invoke (through a confirm card). */
export const PERSONA_WRITES = ["DECIDE_APPROVAL", "REVERSE_DECISION", "EMERGENCY_STOP"] as const;
export type PersonaWrite = (typeof PERSONA_WRITES)[number];

/** Proof procedures (read-only; run on request from the proof view). */
export const PROOF_CALLS = ["VERIFY_LEDGER", "REPLAY_EVIDENCE", "EXPORT_EVIDENCE_PACK"] as const;
export type ProofCall = (typeof PROOF_CALLS)[number];

/** A fully bound call: the exact statement and values that will be sent. */
export interface BoundCall<N extends InterfaceName = InterfaceName> {
  name: N;
  statement: string;
  binds: (string | number | boolean | null | object)[];
}

/** Bind `args` in the interface's parameter order; every parameter must be present (null is a value). */
export function bindCall<N extends InterfaceName>(name: N, args: Record<string, unknown>): BoundCall<N> {
  const spec: InterfaceSpec = INTERFACES[name];
  const missing = spec.params.filter((p) => !(p in args));
  if (missing.length) throw new Error(`${name}: missing argument(s) ${missing.join(", ")}`);
  const extra = Object.keys(args).filter((k) => !spec.params.includes(k));
  if (extra.length) throw new Error(`${name}: unknown argument(s) ${extra.join(", ")}`);
  return {
    name,
    statement: spec.statement,
    binds: spec.params.map((p) => (args[p] ?? null) as BoundCall["binds"][number]),
  };
}
