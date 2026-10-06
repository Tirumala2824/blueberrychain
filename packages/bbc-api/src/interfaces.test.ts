import { schemaNames } from "@blueberrychain/shared";
import { describe, expect, it } from "vitest";
import { INTERFACES, PERSONA_WRITES, PROOF_CALLS, bindCall, type InterfaceSpec } from "./interfaces.js";

const specs = Object.entries(INTERFACES) as [string, InterfaceSpec][];

describe("the interface table (the app's only SQL)", () => {
  it("contains only API procedure calls, API view reads and reads the role is already granted", () => {
    const allowed = [
      /^CALL BBC_OS\.API\.[A-Z_]+\((\?(, \?)*)?\)$/,
      /^SELECT \* FROM BBC_OS\.API\.V_[A-Z_]+ ORDER BY [A-Z_]+$/,
      /^SELECT CURRENT_USER\(\) AS USER_NAME, CURRENT_ROLE\(\) AS ROLE_NAME$/,
      /^SELECT [A-Z_, ]+ FROM BBC_OS\.GOV\.POLICY_VERSIONS WHERE STATUS = 'ACTIVE'$/,
      /^POST \/api\/v2\/[a-z0-9/{}:._A-Z]+$/,
    ];
    for (const [name, spec] of specs) {
      expect(allowed.some((re) => re.test(spec.statement)), `${name}: ${spec.statement}`).toBe(true);
    }
  });

  it("never mutates a table directly", () => {
    const dml = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i;
    for (const [name, spec] of specs) expect(dml.test(spec.statement), name).toBe(false);
  });

  it("binds one placeholder per parameter", () => {
    for (const [name, spec] of specs) {
      if (spec.kind === "rest") continue;
      expect((spec.statement.match(/\?/g) ?? []).length, name).toBe(spec.params.length);
    }
  });

  it("names a result contract that exists", () => {
    const names = new Set(schemaNames());
    for (const [name, spec] of specs) if (spec.resultSchema) expect(names.has(spec.resultSchema), name).toBe(true);
  });

  it("lets only persona roles write, and only through governed procedures", () => {
    for (const name of PERSONA_WRITES) {
      expect(INTERFACES[name].writes).toBe(true);
      expect(INTERFACES[name].kind).toBe("procedure");
      expect(INTERFACES[name].callers.every((r: string) => r.startsWith("BBC_") && r !== "BBC_ENGINE")).toBe(true);
    }
    for (const name of PROOF_CALLS) expect(INTERFACES[name].writes).toBe(false);
  });

  it("binds arguments in parameter order and refuses missing or unknown ones", () => {
    const call = bindCall("DECIDE_APPROVAL", { reason: "ok", verdict: "APPROVE", approval_id: "APR-00000060", chosen_option_id: null });
    expect(call).toEqual({
      name: "DECIDE_APPROVAL",
      statement: "CALL BBC_OS.API.DECIDE_APPROVAL(?, ?, ?, ?)",
      binds: ["APR-00000060", "APPROVE", null, "ok"],
    });
    expect(() => bindCall("DECIDE_APPROVAL", { approval_id: "APR-00000060" })).toThrow(/missing/);
    expect(() => bindCall("EMERGENCY_STOP", { reason: "x", force: true })).toThrow(/unknown/);
  });
});
