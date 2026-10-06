import { FixtureWorld } from "@blueberrychain/bbc-api";
import { describe, expect, it } from "vitest";
import { complete } from "../console/complete";
import { evidenceKind, findEvidence, indexEvidence } from "./evidence";
import { resolveId } from "./ids";

const world = FixtureWorld.load(["S-A", "S-B"]);
const sa = world.tapes[0]!;
const view = sa.frames.find((f) => f.cases["CASE-00000017"]!.view.case.state === "PENDING_APPROVAL")!.cases["CASE-00000017"]!;
const salesView = { ...view.view, viewer: view.viewers["sales"]! };

describe("citations", () => {
  it("indexes every evidence id in the view to a JSON pointer", () => {
    const index = indexEvidence(salesView);
    expect(index.get("EV:OPT:OPT-00000105")!.pointer).toMatch(/^\/options\/\d+$/);
    expect(index.get("EV:DOC:DOC-SFI-044812#pulp_temp_at_loading_c")!.pointer).toBe("/analysis/pack/documents/0/claims/0");
  });

  it("resolves pack pointers and options, and admits what isn't in the view", () => {
    expect(findEvidence(salesView, "EV:PACK:PACK-00000031#/lots/0/custody_exposure/0")!.value).toMatchObject({ holder_party_id: "PARTY-SIERRA" });
    expect(findEvidence(salesView, "EV:SIG:WARM_LOADING@1")).toBeNull();
    expect(evidenceKind("EV:SIG:WARM_LOADING@1")).toBe("Causal signature");
  });
});

describe("ids", () => {
  it("accepts short forms only when unambiguous", () => {
    const ids = ["OPT-00000101", "OPT-00000102", "OPT-00000103"];
    expect(resolveId("102", "OPT", ids, "option")).toEqual({ ok: true, id: "OPT-00000102" });
    expect(resolveId("opt-103", "OPT", ids, "option")).toEqual({ ok: true, id: "OPT-00000103" });
    expect(resolveId("OPT-999", "OPT", ids, "option").ok).toBe(false);
  });
});

describe("console completion", () => {
  it("completes verbs, then ids that exist on the case (the persona's own approvals first)", () => {
    expect(complete("ap", salesView).map((c) => c.value).sort()).toEqual(["approvals ", "approve "]);
    const approvals = complete("approve ", salesView);
    expect(approvals[0]!.value).toBe("approve APR-00000060 ");
    expect(approvals[0]!.hint).toMatch(/yours to decide/);
    expect(complete("why 10", salesView).map((c) => c.label)).toContain("OPT-00000105");
    expect(complete("status ", salesView)).toEqual([]);
  });
});
