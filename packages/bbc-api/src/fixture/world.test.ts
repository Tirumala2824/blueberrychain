import { describe, expect, it } from "vitest";
import { InterfaceUnavailableError, RefusedError } from "../errors.js";
import { bindCall } from "../interfaces.js";
import { FixtureWorld, normalizeQuestion } from "./world.js";

const world = () => FixtureWorld.load(["S-A", "S-B"]);
const approve = (approval_id: string) => bindCall("DECIDE_APPROVAL", { approval_id, verdict: "APPROVE", chosen_option_id: null, reason: "fits the spec" });
const SA = "CASE-00000017";

function seekState(w: FixtureWorld, tape: string, caseId: string, state: string) {
  const t = w.tapes.find((x) => x.tape === tape)!;
  const i = t.frames.findIndex((f) => f.cases[caseId]?.view.case.state === state);
  w.seek(tape, i);
  return i;
}

describe("fixture world (no business logic)", () => {
  it("serves each persona its recorded viewer on the same snapshot", async () => {
    const w = world();
    const sales = await w.portFor("sales").caseView(SA);
    const auditor = await w.portFor("auditor").caseView(SA);
    expect(sales.case).toEqual(auditor.case);
    expect(sales.viewer.user).toBe("BBC_DEMO_SALES");
    expect(auditor.viewer.available_actions.map((a) => a.action)).toContain("VERIFY_LEDGER");
  });

  it("unions every tape's inbox for the persona", async () => {
    const rows = await world().portFor("quality").inbox();
    expect(rows.map((r) => r.case_id).sort()).toEqual(["CASE-00000017", "CASE-00000023"]);
  });

  it("refuses a case that is on no tape", async () => {
    await expect(world().portFor("sales").caseView("CASE-00000999")).rejects.toBeInstanceOf(RefusedError);
  });

  it("plays a recorded response and moves its tape to the recorded frame", async () => {
    const w = world();
    const pending = seekState(w, "S-A", SA, "PENDING_APPROVAL");
    const result = await w.portFor("sales").invoke(approve("APR-00000060"));
    expect(result).toMatchObject({ status: "OK", approval_id: "APR-00000060", approval_status: "APPROVED", case_state: "PENDING_APPROVAL" });
    const now = w.status().find((s) => s.tape === "S-A")!;
    expect(now.frame).not.toBe(pending);
    const view = await w.portFor("quality").caseView(SA);
    expect(view.governance.approvals.find((a) => a.approval_id === "APR-00000060")!.status).toBe("APPROVED");
  });

  it("matches only by persona, frame and the recorded arguments", async () => {
    const w = world();
    seekState(w, "S-A", SA, "PENDING_APPROVAL");
    const asFinance = await w.portFor("finance").invoke(approve("APR-00000060"));
    expect(asFinance).toMatchObject({ status: "DENIED", code: "FIXTURE_NO_RECORDING" });
    const reject = bindCall("DECIDE_APPROVAL", { approval_id: "APR-00000060", verdict: "REJECT", chosen_option_id: null, reason: "no" });
    expect(await w.portFor("sales").invoke(reject)).toMatchObject({ status: "DENIED", code: "FIXTURE_NO_RECORDING" });
    w.seek("S-A", 0);
    expect(await w.portFor("sales").invoke(approve("APR-00000060"))).toMatchObject({ code: "FIXTURE_NO_RECORDING" });
  });

  it("treats a read with no recording as not granted (the policy is the governance admin's)", async () => {
    const w = world();
    await expect(w.portFor("govadmin").activePolicy()).resolves.toMatchObject({ status: "ACTIVE", policy_version: "1" });
    await expect(w.portFor("sales").activePolicy()).rejects.toBeInstanceOf(InterfaceUnavailableError);
  });

  it("replays recorded agent traces and Analyst answers verbatim", () => {
    const w = world();
    expect(w.trace("RUN-00000210")!.length).toBeGreaterThan(5);
    expect(w.trace("RUN-00000999")).toBeNull();
    const hit = w.analyst("  which lots have less than 10 days of shelf life left  ");
    expect("answer" in hit && hit.answer.rows.length).toBe(2);
    const miss = w.analyst("what is the meaning of life?");
    expect("recorded" in miss && miss.recorded.length).toBeGreaterThan(0);
    expect(normalizeQuestion("A  b?")).toBe("a b");
  });

  it("bounds seek and step, and resets every tape", () => {
    const w = world();
    expect(() => w.seek("S-A", 999)).toThrow(/no frame/);
    w.step("S-A", 99);
    const sa = w.status().find((s) => s.tape === "S-A")!;
    expect(sa.frame).toBe(sa.frames - 1);
    w.reset();
    expect(w.status().every((s) => s.frame === 0)).toBe(true);
  });
});
