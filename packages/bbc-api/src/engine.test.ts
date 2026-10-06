import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SqlApiClient, contractsDir } from "@blueberrychain/shared";
import { describe, expect, it } from "vitest";
import { ContractViolationError } from "./errors.js";
import { createSqlEnginePort, type AgentRunRecord, type DispatchReport } from "./engine.js";
import { scriptedFetch, variantCell } from "./testing.js";

const fixture = <T>(name: string, i = 0) =>
  (JSON.parse(readFileSync(join(contractsDir(), "fixtures", "api", `${name}.json`), "utf-8")) as { valid: T[] }).valid[i]!;

function engine(responses: Parameters<typeof scriptedFetch>[0]) {
  const f = scriptedFetch(responses);
  return { port: createSqlEnginePort(new SqlApiClient({ account: "acct", token: "pat-engine", role: "BBC_ENGINE", backoffMs: 1, fetch: f.impl })), calls: f.calls };
}

const statements = (calls: { body: Record<string, unknown> | null }[]) =>
  calls.map((c) => [c.body!["statement"], Object.values(c.body!["bindings"] as Record<string, { value: unknown }>).map((b) => b.value)]);

describe("engine port", () => {
  it("leases work and advances cases through the API procedures only", async () => {
    const { port, calls } = engine([variantCell(fixture("claim_work_result")), variantCell(fixture("advance_case_result"))]);
    await port.claimWork("engine-1/worker-0", 120);
    await port.advanceCase("CASE-00000017", "OPEN");
    expect(statements(calls)).toEqual([
      ["CALL BBC_OS.API.CLAIM_WORK(?, ?)", ["engine-1/worker-0", "120"]],
      ["CALL BBC_OS.API.ADVANCE_CASE(?, ?)", ["CASE-00000017", "OPEN"]],
    ]);
  });

  it("opens and closes agent runs; the record travels as JSON", async () => {
    const record = fixture<AgentRunRecord>("agent_run_record");
    const { port, calls } = engine([variantCell(fixture("start_agent_run_result")), variantCell(fixture("end_agent_run_result"))]);
    await port.startAgentRun({ case_id: "CASE-00000023", agent: "EXCURSION_FORENSICS", decision_point: "D1", provider: "cortex-agent", model: null });
    await port.endAgentRun("RUN-00000210", record);
    const [start, end] = statements(calls);
    expect(start).toEqual(["CALL BBC_OS.API.START_AGENT_RUN(?, ?, ?, ?, ?)", ["CASE-00000023", "EXCURSION_FORENSICS", "D1", "cortex-agent", null]]);
    expect(end![0]).toBe("CALL BBC_OS.API.END_AGENT_RUN(?, ?)");
    expect(JSON.parse((end![1] as string[])[1]!)).toEqual(record);
  });

  it("refuses to send a dispatch report that breaks its contract", async () => {
    const { port, calls } = engine([]);
    const report = { ...fixture<DispatchReport>("dispatch_report"), outcome: "DONE" } as unknown as DispatchReport;
    await expect(port.ackMutation("MUT-00000301", report)).rejects.toBeInstanceOf(ContractViolationError);
    expect(calls).toHaveLength(0);
  });

  it("leases dispatchable mutations and acknowledges them", async () => {
    const { port, calls } = engine([variantCell(fixture("next_actions_result")), variantCell(fixture("ack_mutation_result"))]);
    const leased = await port.nextActions("engine-1/dispatcher", 5);
    expect(leased.status === "OK" && leased.items[0]!.mutation_id).toBe("MUT-00000301");
    await port.ackMutation("MUT-00000301", fixture<DispatchReport>("dispatch_report"));
    expect(statements(calls).map((s) => s[0])).toEqual(["CALL BBC_OS.API.NEXT_ACTIONS(?, ?)", "CALL BBC_OS.API.ACK_MUTATION(?, ?)"]);
  });
});
