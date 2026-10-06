/**
 * Shared decision-contract types and constants for BlueberryChain OS.
 *
 * Types generated from contracts/schemas live in src/generated (run "pnpm generate"); the lifecycle
 * itself is frozen product design (see docs/design/implementation-plan.md).
 */

export const CONTRACT_VERSION = "0.1.0";

/** The Recovery Case lifecycle - the core of the product, in order. */
export const LIFECYCLE_STAGES = [
  "EVENT",
  "DETECTION",
  "UNDERSTANDING",
  "OPTIONS",
  "EVALUATION",
  "RECOMMENDATION",
  "GOVERNANCE",
  "APPROVAL",
  "EXECUTION",
  "OUTCOME",
  "AUDIT",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** D1 = recovery (hours), D2 = settlement (after the salvage outcome is known). */
export const DECISION_POINTS = ["D1", "D2"] as const;
export type DecisionPoint = (typeof DECISION_POINTS)[number];

/** Who made a recommendation. FALLBACK = the deadline watchdog's safe hold. */
export const DECIDER_KINDS = ["RULE", "AGENT", "HUMAN", "FALLBACK"] as const;
export type DeciderKind = (typeof DECIDER_KINDS)[number];

/** Autonomy levels: L0 observe ... L4 execute material actions after approval. */
export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export { contractsDir, schemaNames, validate, type ContractError } from "./contracts.js";
export type * from "./generated/index.js";
