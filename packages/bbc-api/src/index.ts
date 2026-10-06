/**
 * @blueberrychain/bbc-api: the application layer's only way into Snowflake.
 *
 * - `INTERFACES` lists every approved interface (fixed statements, caller roles,
 *   result contracts, the work package that delivers each one).
 * - `createSqlPersonaPort` / `createSqlEnginePort` run them over the SQL API as one
 *   identity, validating every result against its contract (fail closed).
 * - `FixtureWorld` replays recorded tapes through the same PersonaPort, with no logic.
 */

export { INTERFACES, PERSONA_WRITES, PROOF_CALLS, bindCall } from "./interfaces.js";
export type { BoundCall, CallerRole, InterfaceName, InterfaceSpec, PersonaRole, PersonaWrite, ProofCall, ServiceRole } from "./interfaces.js";
export { AuthError, ContractViolationError, InterfaceUnavailableError, RefusedError, isRefusal, mapSnowflakeError } from "./errors.js";
export type { Refusal } from "./errors.js";
export { createSqlPersonaPort } from "./persona.js";
export type {
  ActivePolicy, AvailableAction, CaseView, DecideApprovalResult, EmergencyStopResult, ExportResult, InboxRow, PersonaCall,
  PersonaCallResults, PersonaPort, ReplayResult, ReverseDecisionResult, VerifyLedgerResult, Viewer, Whoami,
} from "./persona.js";
export { createSqlEnginePort } from "./engine.js";
export type {
  AckMutationResult, AdvanceCaseResult, AgentRunRecord, ClaimWorkResult, DispatchReport, EndAgentRunResult, EnginePort,
  NextActionsResult, StartAgentRunArgs, StartAgentRunResult,
} from "./engine.js";
export { AnalystClient, SEMANTIC_VIEW, answerQuestion, checkAnalystSql } from "./analyst.js";
export type { AnalystAnswer, AnalystConfig, AnalystReply, SqlCheck } from "./analyst.js";
export { SseParser, formatSse, readSse } from "./sse.js";
export type { SseEvent } from "./sse.js";
export { FixtureWorld, PERSONAS, deepEqual, normalizeQuestion, tapeErrors } from "./fixture/world.js";
export type { AgentTraceStep, Persona, Tape, TapePosition } from "./fixture/world.js";
