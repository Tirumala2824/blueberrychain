import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SqlApiClient, contractsDir } from "@blueberrychain/shared";
import { describe, expect, it } from "vitest";
import { AuthError, ContractViolationError, InterfaceUnavailableError, RefusedError } from "./errors.js";
import { bindCall } from "./interfaces.js";
import { createSqlPersonaPort } from "./persona.js";
import { scriptedFetch, variantCell } from "./testing.js";

const fixture = (name: string, i = 0) =>
  (JSON.parse(readFileSync(join(contractsDir(), "fixtures", "api", `${name}.json`), "utf-8")) as { valid: unknown[] }).valid[i];

function port(responses: Parameters<typeof scriptedFetch>[0]) {
  const f = scriptedFetch(responses);
  const client = new SqlApiClient({ account: "acct", token: "pat-sales", role: "BBC_SALES_MGR", backoffMs: 1, fetch: f.impl, queryTag: "bbc-ct" });
  return { port: createSqlPersonaPort(client), calls: f.calls };
}

describe("live persona port", () => {
  it("reads the identity from Snowflake, not from the app", async () => {
    const { port: p, calls } = port([{ status: 200, body: {
      data: [["BBC_DEMO_SALES", "BBC_SALES_MGR"]],
      resultSetMetaData: { rowType: [{ name: "USER_NAME", type: "TEXT" }, { name: "ROLE_NAME", type: "TEXT" }] },
    } }]);
    expect(await p.whoami()).toEqual({ user: "BBC_DEMO_SALES", role: "BBC_SALES_MGR" });
    expect(calls[0]!.body).toMatchObject({ statement: "SELECT CURRENT_USER() AS USER_NAME, CURRENT_ROLE() AS ROLE_NAME", role: "BBC_SALES_MGR" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer pat-sales");
  });

  it("calls GET_CASE_VIEW with the case id bound, and returns the validated view", async () => {
    const view = fixture("case_view");
    const { port: p, calls } = port([variantCell(view)]);
    await expect(p.caseView("CASE-00000017")).resolves.toEqual(view);
    expect(calls[0]!.body).toMatchObject({
      statement: "CALL BBC_OS.API.GET_CASE_VIEW(?)",
      bindings: { "1": { type: "TEXT", value: "CASE-00000017" } },
      parameters: { query_tag: "bbc-ct:case_view" },
    });
  });

  it("fails closed when Snowflake returns a view that breaks the contract", async () => {
    const view = structuredClone(fixture("case_view")) as Record<string, unknown>;
    delete view["governance"];
    const { port: p } = port([variantCell(view)]);
    await expect(p.caseView("CASE-00000017")).rejects.toBeInstanceOf(ContractViolationError);
  });

  it("surfaces a refused read as RefusedError", async () => {
    const { port: p } = port([variantCell({ status: "INVALID", errors: ["case CASE-00000099 not found"], code: "NOT_FOUND" })]);
    const error = await p.caseView("CASE-00000099").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RefusedError);
    expect((error as RefusedError).refusal.code).toBe("NOT_FOUND");
  });

  it("maps 'does not exist or not authorized' to InterfaceUnavailableError, naming the work package", async () => {
    const { port: p } = port([{ status: 422, body: { message: "SQL compilation error: Object 'BBC_OS.API.V_CASE_INBOX' does not exist or not authorized.", code: "002003" } }]);
    const error = await p.inbox().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InterfaceUnavailableError);
    expect((error as InterfaceUnavailableError).delivers).toMatch(/8\.3/);
  });

  it("maps a refused credential to AuthError", async () => {
    const { port: p } = port([{ status: 401, body: { message: "Programmatic access token is invalid" } }]);
    await expect(p.whoami()).rejects.toBeInstanceOf(AuthError);
  });

  it("validates every inbox row", async () => {
    const row = fixture("inbox_row") as Record<string, unknown>;
    const rowType = Object.keys(row).map((name) => ({ name: name.toUpperCase(), type: "VARIANT" }));
    const cells = Object.values(row).map((v) => JSON.stringify(v));
    const { port: p } = port([{ status: 200, body: { data: [cells], resultSetMetaData: { rowType } } }]);
    expect(await p.inbox()).toEqual([row]);
  });

  it("runs a governed write exactly as bound, and validates the result", async () => {
    const result = fixture("decide_approval_result");
    const { port: p, calls } = port([variantCell(result)]);
    const call = bindCall("DECIDE_APPROVAL", { approval_id: "APR-00000060", verdict: "APPROVE", chosen_option_id: null, reason: null });
    await expect(p.invoke(call)).resolves.toEqual(result);
    expect(calls[0]!.body).toMatchObject({
      statement: "CALL BBC_OS.API.DECIDE_APPROVAL(?, ?, ?, ?)",
      bindings: { "1": { value: "APR-00000060" }, "2": { value: "APPROVE" }, "3": { value: null }, "4": { value: null } },
    });
  });

  it("refuses a call whose statement isn't the table's", async () => {
    const { port: p, calls } = port([]);
    const call = { ...bindCall("EMERGENCY_STOP", { reason: "x" }), statement: "CALL BBC_OS.DECISION.MUTATE(?)" } as const;
    await expect(p.invoke(call)).rejects.toThrow(/does not match/);
    expect(calls).toHaveLength(0);
  });
});
