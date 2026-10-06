/**
 * What the console shows: every input produces one entry carrying a structured
 * artifact, rendered from governed read-model fields or from a Snowflake result.
 * Artifacts are data (no markup), so the server builds them and the browser renders.
 */

import type {
  AnalystAnswer,
  CaseView,
  InterfaceName,
  PersonaCall,
  PersonaCallResults,
} from "@blueberrychain/bbc-api";

type Option = CaseView["options"][number];
type Recommendation = CaseView["decision"]["recommendations"][number];
type Approval = CaseView["governance"]["approvals"][number];
type Mutation = CaseView["execution"]["mutations"][number];
type Run = CaseView["agents"]["runs"][number];
type LedgerEntry = CaseView["evidence"]["ledger"]["entries"][number];

export interface StatusArtifact {
  type: "status";
  case_id: string;
  decision_point: CaseView["case"]["decision_point"];
  state: CaseView["case"]["state"];
  stage: string;
  state_text: string;
  deadline_ts: string | null;
  fallback: CaseView["governance"]["fallback"];
  value_at_risk_usd: number | null;
  recommendation: { option_id: string; label: string | null; decided_by: string; decider_id: string; audit_status: string } | null;
  awaiting_roles: string[];
  my_actions: { action: string; enabled: boolean; text: string }[];
  generated_at: string;
}

export interface BriefArtifact {
  type: "brief";
  question: number | null;
  brief: NonNullable<Recommendation["brief"]>;
  decided_by: Recommendation["decided_by"];
  decider_id: string;
  audit_status: Recommendation["audit_status"];
  audit_verdict: Recommendation["audit_verdict"];
  audited_text: string | null;
  run_id: string | null;
}

export interface OptionArtifact {
  type: "option";
  option: Option;
  recommended: boolean;
  is_do_nothing: boolean;
  eliminated: { code: string; text: string; detail: string; evidence_id: string | null }[];
  agent_reason: string | null;
}

export interface CompareArtifact {
  type: "compare";
  options: Option[];
  recommended_id: string | null;
}

export interface EvidenceArtifact {
  type: "evidence";
  evidence_id: string;
  found: boolean;
  pointer: string | null;
  label: string | null;
  value: unknown;
}

export interface TraceArtifact {
  type: "trace";
  run: Run;
}

export interface LedgerArtifact {
  type: "ledger";
  entries: LedgerEntry[];
  total: number;
}

export interface MutationArtifact {
  type: "mutation";
  mutations: Mutation[];
}

export interface OutcomeArtifact {
  type: "outcome";
  lots: CaseView["outcome"]["lots"];
  claims: CaseView["outcome"]["claims"];
}

export interface PolicyArtifact {
  type: "policy";
  policy: CaseView["governance"]["policy"];
  evaluation: CaseView["governance"]["evaluations"][number] | null;
}

export interface ApprovalsArtifact {
  type: "approvals";
  approvals: Approval[];
  my_actions: { approval_id: string | null; enabled: boolean; text: string }[];
}

export interface HelpArtifact {
  type: "help";
  commands: { usage: string; summary: string; group: string }[];
}

export interface ProofArtifact<N extends PersonaCall = PersonaCall> {
  type: "proof";
  call: N;
  result: PersonaCallResults[N];
}

export interface AnalystArtifact {
  type: "analyst";
  answer: AnalystAnswer;
  recorded: boolean;
}

export interface AnalystMissArtifact {
  type: "analyst_miss";
  question: string;
  recorded_questions: string[];
}

export interface ConfirmCard {
  token: string;
  expires_at: string;
  summary: string;
  procedure: InterfaceName;
  statement: string;
  binds: { name: string; value: unknown }[];
  persona: string;
  user: string;
  role: string;
  case_id: string | null;
  brief_hash: string | null;
  warnings: string[];
  fixture: boolean;
}

export interface ConfirmArtifact {
  type: "confirm";
  card: ConfirmCard;
}

export interface ReceiptArtifact {
  type: "receipt";
  call: PersonaCall;
  summary: string;
  result: PersonaCallResults[PersonaCall];
}

export interface ErrorArtifact {
  type: "error";
  message: string;
  /** Snowflake's refusal code, when Snowflake refused. */
  code: string | null;
  suggestions: string[];
}

export type Artifact =
  | StatusArtifact
  | BriefArtifact
  | OptionArtifact
  | CompareArtifact
  | EvidenceArtifact
  | TraceArtifact
  | LedgerArtifact
  | MutationArtifact
  | OutcomeArtifact
  | PolicyArtifact
  | ApprovalsArtifact
  | HelpArtifact
  | ProofArtifact
  | AnalystArtifact
  | AnalystMissArtifact
  | ConfirmArtifact
  | ReceiptArtifact
  | ErrorArtifact;

export interface ConsoleEntry {
  id: string;
  at: string;
  case_id: string | null;
  input: string;
  user: string;
  role: string;
  artifact: Artifact;
}
