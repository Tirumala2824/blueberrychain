/**
 * Fixture mode: replays recorded tapes (contracts/tapes/*.json) through the same
 * PersonaPort the live adapter implements. The player has fixed rules and no business
 * logic. It evaluates no policy, runs no state machine and computes no numbers:
 *
 * - reads return the current frame's snapshot, with the persona's recorded viewer;
 * - a call matches a recorded response only by name, persona, current frame and the
 *   deep-equality of the arguments the recording lists; a match may move the tape to
 *   its recorded frame;
 * - a call with no recording is refused (DENIED, FIXTURE_NO_RECORDING), and a read with
 *   no recording behaves as not granted to that identity.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir, validate, type ApiAnalystAnswer, type ApiTape } from "@blueberrychain/shared";
import { InterfaceUnavailableError, RefusedError } from "../errors.js";
import { INTERFACES, type BoundCall, type InterfaceName } from "../interfaces.js";
import type { ActivePolicy, CaseView, InboxRow, PersonaCall, PersonaCallResults, PersonaPort } from "../persona.js";

export type Tape = ApiTape.FixtureTape;
export type Persona = ApiTape.Persona;
export type AgentTraceStep = NonNullable<Tape["agent_traces"][string]>[number];

export const PERSONAS: readonly Persona[] = ["quality", "sales", "finance", "auditor", "govadmin"];

export interface TapePosition {
  tape: string;
  title: string;
  provenance: string;
  frame: number;
  frames: number;
  label: string;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Normalize a question for exact recorded-answer lookup. */
export function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
}

/** Check one tape against its contract and every recorded result against its call's result schema. */
export function tapeErrors(tape: unknown): string[] {
  const errors = validate("api/tape.json", tape).map((e) => `${e.path} ${e.message}`);
  if (errors.length) return errors;
  const t = tape as Tape;
  t.responses.forEach((r, i) => {
    const schema = INTERFACES[r.call as InterfaceName].resultSchema;
    if (schema) for (const e of validate(schema, r.result)) errors.push(`/responses/${i}/result${e.path} ${e.message}`);
    for (const f of r.at_frames) if (f >= t.frames.length) errors.push(`/responses/${i}/at_frames: no frame ${f}`);
    if (r.advance_to_frame !== null && r.advance_to_frame >= t.frames.length) errors.push(`/responses/${i}/advance_to_frame: no frame ${r.advance_to_frame}`);
  });
  return errors;
}

export class FixtureWorld {
  private readonly positions = new Map<string, number>();

  constructor(readonly tapes: readonly Tape[]) {
    const names = new Set<string>();
    for (const tape of tapes) {
      if (names.has(tape.tape)) throw new Error(`tape ${tape.tape} loaded twice`);
      names.add(tape.tape);
      const errors = tapeErrors(tape);
      if (errors.length) throw new Error(`tape ${tape.tape} is invalid: ${errors.slice(0, 3).join("; ")}`);
    }
    this.reset();
  }

  /** Load tapes from contracts/tapes (all of them, or the named ones in order). */
  static load(names?: readonly string[], dir = join(contractsDir(), "tapes")): FixtureWorld {
    const available = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    const wanted = names?.length ? names : available;
    const missing = wanted.filter((n) => !available.includes(n));
    if (missing.length) throw new Error(`no such tape(s): ${missing.join(", ")} (have ${available.join(", ")})`);
    return new FixtureWorld(wanted.map((n) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf-8")) as Tape));
  }

  reset(): void {
    for (const tape of this.tapes) this.positions.set(tape.tape, 0);
  }

  status(): TapePosition[] {
    return this.tapes.map((t) => {
      const frame = this.frameIndex(t);
      return { tape: t.tape, title: t.title, provenance: t.provenance, frame, frames: t.frames.length, label: t.frames[frame]!.label };
    });
  }

  seek(tapeName: string, frame: number): void {
    const tape = this.tape(tapeName);
    if (!Number.isInteger(frame) || frame < 0 || frame >= tape.frames.length) throw new Error(`tape ${tapeName} has no frame ${frame}`);
    this.positions.set(tapeName, frame);
  }

  step(tapeName: string, delta: number): void {
    const tape = this.tape(tapeName);
    this.seek(tapeName, Math.min(tape.frames.length - 1, Math.max(0, this.frameIndex(tape) + delta)));
  }

  /** The Snowflake identity each persona signs in as (the same on every tape). */
  identity(persona: Persona): { user: string; role: string } | null {
    for (const tape of this.tapes) {
      const p = tape.personas[persona];
      if (p) return p;
    }
    return null;
  }

  /** Recorded agent trace for a run, with its recorded pacing. */
  trace(runId: string): AgentTraceStep[] | null {
    for (const tape of this.tapes) {
      const steps = tape.agent_traces[runId];
      if (steps) return steps;
    }
    return null;
  }

  /** A recorded Analyst answer for this exact question, or the questions that were recorded. */
  analyst(question: string): { answer: ApiAnalystAnswer.AnalystAnswer } | { recorded: string[] } {
    const key = normalizeQuestion(question);
    for (const tape of this.tapes) {
      const hit = tape.analyst.find((a) => normalizeQuestion(a.question) === key);
      if (hit) return { answer: hit.answer };
    }
    return { recorded: this.tapes.flatMap((t) => t.analyst.map((a) => a.question)) };
  }

  portFor(persona: Persona): PersonaPort {
    const identity = this.identity(persona);
    if (!identity) throw new Error(`no tape defines persona ${persona}`);
    return {
      mode: "fixture",
      whoami: async () => ({ ...identity }),
      inbox: async () => structuredClone(this.tapes.flatMap((t) => (this.frame(t).inbox[persona] ?? []) as InboxRow[])),
      caseView: async (caseId) => {
        for (const tape of this.tapes) {
          const entry = this.frame(tape).cases[caseId];
          if (!entry) continue;
          const viewer = entry.viewers[persona];
          if (!viewer) throw new InterfaceUnavailableError("GET_CASE_VIEW");
          return structuredClone({ ...(entry.view as CaseView), viewer }) as CaseView;
        }
        throw new RefusedError("GET_CASE_VIEW", {
          status: "INVALID",
          errors: [`case ${caseId} is not on any loaded tape at its current frame`],
          code: "NOT_FOUND",
        });
      },
      activePolicy: async () => {
        const hit = this.match(persona, "ACTIVE_POLICY", {});
        if (!hit) throw new InterfaceUnavailableError("ACTIVE_POLICY");
        return hit as ActivePolicy;
      },
      invoke: async <N extends PersonaCall>(call: BoundCall & { name: N }) => {
        const spec = INTERFACES[call.name];
        if (call.statement !== spec.statement) throw new Error(`${call.name}: statement does not match the interface table`);
        const args = Object.fromEntries(spec.params.map((p, i) => [p, call.binds[i] ?? null]));
        const hit = this.match(persona, call.name, args);
        if (hit) return hit as PersonaCallResults[N];
        return {
          status: "DENIED",
          errors: [`fixture mode: the loaded tapes have no recording of ${call.name} by ${persona} with these arguments at the current frame`],
          code: "FIXTURE_NO_RECORDING",
        } as PersonaCallResults[N];
      },
    };
  }

  private match(persona: Persona, call: string, args: Record<string, unknown>): unknown {
    for (const tape of this.tapes) {
      const frame = this.frameIndex(tape);
      const hit = tape.responses.find(
        (r) =>
          r.call === call &&
          r.persona === persona &&
          r.at_frames.includes(frame) &&
          Object.entries(r.match).every(([k, v]) => deepEqual(args[k], v)),
      );
      if (!hit) continue;
      if (hit.advance_to_frame !== null) this.positions.set(tape.tape, hit.advance_to_frame);
      return structuredClone(hit.result);
    }
    return null;
  }

  private tape(name: string): Tape {
    const tape = this.tapes.find((t) => t.tape === name);
    if (!tape) throw new Error(`no tape ${name}`);
    return tape;
  }

  private frameIndex(tape: Tape): number {
    return this.positions.get(tape.tape) ?? 0;
  }

  private frame(tape: Tape) {
    return tape.frames[this.frameIndex(tape)]!;
  }
}
