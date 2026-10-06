import { describe, expect, it } from "vitest";
import { AUTONOMY_LEVELS, DECIDER_KINDS, DECISION_POINTS, LIFECYCLE_STAGES } from "./index.js";

describe("frozen lifecycle", () => {
  it("has the 11 stages in order, EVENT to AUDIT", () => {
    expect(LIFECYCLE_STAGES).toHaveLength(11);
    expect(LIFECYCLE_STAGES[0]).toBe("EVENT");
    expect(LIFECYCLE_STAGES.indexOf("GOVERNANCE")).toBeLessThan(LIFECYCLE_STAGES.indexOf("EXECUTION"));
    expect(LIFECYCLE_STAGES.at(-1)).toBe("AUDIT");
  });

  it("defines both decision points, the decider kinds and five autonomy levels", () => {
    expect(DECISION_POINTS).toEqual(["D1", "D2"]);
    expect(DECIDER_KINDS).toContain("FALLBACK");
    expect(AUTONOMY_LEVELS).toEqual([0, 1, 2, 3, 4]);
  });
});
