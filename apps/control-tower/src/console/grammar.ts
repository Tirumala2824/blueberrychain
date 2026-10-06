/**
 * The console grammar: a fixed set of verbs. Nothing typed here is interpreted by a
 * language model; free-text questions go to Cortex Analyst only when they start with
 * `ask` or `?`, and their answers are never decision evidence.
 */

export type Command =
  | { verb: "status" }
  | { verb: "brief"; question: number | null }
  | { verb: "why"; option: string }
  | { verb: "compare"; a: string; b: string }
  | { verb: "evidence"; id: string }
  | { verb: "trace"; run: string | null }
  | { verb: "ledger"; count: number | null }
  | { verb: "exec"; mutation: string | null }
  | { verb: "outcome" }
  | { verb: "policy" }
  | { verb: "approvals" }
  | { verb: "help"; topic: string | null }
  | { verb: "verify"; table: string | null }
  | { verb: "replay"; pack: string | null }
  | { verb: "export" }
  | { verb: "approve"; approval: string | null; reason: string | null }
  | { verb: "choose"; option: string; approval: string | null; reason: string | null }
  | { verb: "reject"; approval: string | null; reason: string | null }
  | { verb: "reverse"; rec: string | null; reason: string | null }
  | { verb: "stop-dispatch"; reason: string | null }
  | { verb: "ask"; question: string };

export type Verb = Command["verb"];
export type Group = "Read" | "Proof" | "Decide" | "Ask";

export interface VerbSpec {
  verb: Verb;
  group: Group;
  usage: string;
  summary: string;
  /** Kinds of id the argument positions complete to. */
  completes?: ("option" | "approval" | "run" | "mutation" | "pack" | "evidence" | "rec")[];
}

export const VERBS: VerbSpec[] = [
  { verb: "status", group: "Read", usage: "status", summary: "Where the case is, what it's waiting for, and the clock" },
  { verb: "brief", group: "Read", usage: "brief [q1..q6]", summary: "The Decision Brief, or one of its six questions" },
  { verb: "why", group: "Read", usage: "why OPT-…", summary: "Why an option ranks where it does, or why it was eliminated", completes: ["option"] },
  { verb: "compare", group: "Read", usage: "compare OPT-… OPT-…", summary: "Two options side by side, as scored", completes: ["option", "option"] },
  { verb: "evidence", group: "Read", usage: "evidence EV:…", summary: "Resolve a citation to the fact it points at", completes: ["evidence"] },
  { verb: "trace", group: "Read", usage: "trace [RUN-…]", summary: "An agent run: its tool calls and recorded trace", completes: ["run"] },
  { verb: "ledger", group: "Read", usage: "ledger [n]", summary: "The last n ledger entries for this case", },
  { verb: "exec", group: "Read", usage: "exec [MUT-…]", summary: "Gateway mutations: status, before and after", completes: ["mutation"] },
  { verb: "outcome", group: "Read", usage: "outcome", summary: "Predicted vs realized vs doing nothing; claims" },
  { verb: "policy", group: "Read", usage: "policy", summary: "Policy version, kill switches and how it evaluated this case" },
  { verb: "approvals", group: "Read", usage: "approvals", summary: "Who must approve, by when, and what you can do" },
  { verb: "help", group: "Read", usage: "help [verb]", summary: "This list" },
  { verb: "verify", group: "Proof", usage: "verify [--table DB.SCHEMA.TABLE]", summary: "Recompute the whole ledger's hash chain in Snowflake (or a clone's)" },
  { verb: "replay", group: "Proof", usage: "replay [PACK-…]", summary: "Rebuild an evidence pack as of its time and compare hashes", completes: ["pack"] },
  { verb: "export", group: "Proof", usage: "export", summary: "Export the evidence pack and ledger slice (signed link)" },
  { verb: "approve", group: "Decide", usage: 'approve [APR-…] reason "…"', summary: "Approve the recommendation (asks you to confirm)", completes: ["approval"] },
  { verb: "choose", group: "Decide", usage: 'choose OPT-… [APR-…] reason "…"', summary: "Approve a different scored option instead", completes: ["option", "approval"] },
  { verb: "reject", group: "Decide", usage: 'reject [APR-…] reason "…"', summary: "Reject; the safe fallback runs", completes: ["approval"] },
  { verb: "reverse", group: "Decide", usage: 'reverse [REC-…] reason "…"', summary: "Reverse an executed decision through compensations", completes: ["rec"] },
  { verb: "stop-dispatch", group: "Decide", usage: 'stop-dispatch reason "…"', summary: "Emergency stop: halt all dispatch to external systems" },
  { verb: "ask", group: "Ask", usage: "ask <question>  (or ? <question>)", summary: "A metric question for Cortex Analyst over the semantic view" },
];

export const WRITE_VERBS = new Set<Verb>(["approve", "choose", "reject", "reverse", "stop-dispatch"]);
export const PROOF_VERBS = new Set<Verb>(["verify", "replay", "export"]);
