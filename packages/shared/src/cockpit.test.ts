import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASE_STATES, COCKPIT_STAGES, cockpitStageOf } from "./cockpit.js";
import { contractsDir } from "./contracts.js";

const common = JSON.parse(readFileSync(join(contractsDir(), "schemas", "common.json"), "utf-8")) as {
  $defs: { case_state: { enum: string[] } };
};

describe("cockpit stages", () => {
  it("lists exactly the contract's case states, in order", () => {
    expect([...CASE_STATES]).toEqual(common.$defs.case_state.enum);
  });

  it("puts every state on one of the 8 rail stages, and every stage has a state", () => {
    const used = new Set(CASE_STATES.map(cockpitStageOf));
    for (const state of CASE_STATES) expect(COCKPIT_STAGES).toContain(cockpitStageOf(state));
    expect(used).toEqual(new Set(COCKPIT_STAGES));
  });

  it("keeps the rail in lifecycle order", () => {
    const order = CASE_STATES.map((s) => COCKPIT_STAGES.indexOf(cockpitStageOf(s)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
