import { describe, expect, it } from "vitest";
import { SqlApiClient, SqlApiError, decodeCell, sqlApiConfigFromEnv } from "./sqlapi.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, impl };
}

const base = { account: "pndvhar-pt70809", token: "tok", role: "BBC_INGEST", backoffMs: 1, pollIntervalMs: 1 };

describe("SqlApiClient", () => {
  it("sends the PAT, role and TEXT bindings", async () => {
    const f = fakeFetch([{ status: 200, body: { data: [['{"status":"OK"}']] } }]);
    const client = new SqlApiClient({ ...base, warehouse: "BBC_APP_WH", database: "BBC_OS", fetch: f.impl });
    const out = await client.callJson("CALL P(?, ?, ?)", ["a", 3, { k: [1] }]);
    expect(out).toEqual({ status: "OK" });
    const { url, init } = f.calls[0]!;
    expect(url).toMatch(/^https:\/\/pndvhar-pt70809\.snowflakecomputing\.com\/api\/v2\/statements\?requestId=/);
    expect(url).not.toContain("retry=true");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Snowflake-Authorization-Token-Type"]).toBe("PROGRAMMATIC_ACCESS_TOKEN");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ role: "BBC_INGEST", warehouse: "BBC_APP_WH", database: "BBC_OS" });
    expect(body.bindings).toEqual({
      "1": { type: "TEXT", value: "a" },
      "2": { type: "TEXT", value: "3" },
      "3": { type: "TEXT", value: '{"k":[1]}' },
    });
  });

  it("retries transient failures with the same requestId and retry=true", async () => {
    const f = fakeFetch([
      new TypeError("socket hang up"),
      { status: 503, body: { message: "busy" } },
      { status: 200, body: { data: [["1"]] } },
    ]);
    const rows = await new SqlApiClient({ ...base, fetch: f.impl }).query("SELECT 1");
    expect(rows).toEqual([["1"]]);
    const ids = f.calls.map((c) => new URL(c.url).searchParams.get("requestId"));
    expect(new Set(ids).size).toBe(1);
    expect(f.calls.map((c) => new URL(c.url).searchParams.get("retry"))).toEqual([null, "true", "true"]);
  });

  it("does not retry SQL errors", async () => {
    const f = fakeFetch([
      { status: 422, body: { message: "Object does not exist", code: "002003", sqlState: "02000" } },
    ]);
    const error = await new SqlApiClient({ ...base, fetch: f.impl }).query("CALL NOPE()").catch((e) => e);
    expect(error).toBeInstanceOf(SqlApiError);
    expect(error).toMatchObject({ status: 422, retryable: false, code: "002003" });
    expect(f.calls).toHaveLength(1);
  });

  it("polls a 202 until the statement finishes and reads every partition", async () => {
    const f = fakeFetch([
      { status: 202, body: { statementHandle: "h1", statementStatusUrl: "/api/v2/statements/h1" } },
      { status: 202, body: { statementHandle: "h1", statementStatusUrl: "/api/v2/statements/h1" } },
      {
        status: 200,
        body: { statementHandle: "h1", data: [["a"]], resultSetMetaData: { partitionInfo: [{}, {}] } },
      },
      { status: 200, body: { data: [["b"]] } },
    ]);
    const rows = await new SqlApiClient({ ...base, fetch: f.impl }).query("SELECT x");
    expect(rows).toEqual([["a"], ["b"]]);
    expect(f.calls.map((c) => c.init.method)).toEqual(["POST", "GET", "GET", "GET"]);
    expect(f.calls[3]!.url).toContain("/api/v2/statements/h1?partition=1");
  });

  it("gives up after maxAttempts", async () => {
    const f = fakeFetch([
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    const error = await new SqlApiClient({ ...base, maxAttempts: 2, fetch: f.impl })
      .query("SELECT 1")
      .catch((e) => e);
    expect(error).toMatchObject({ status: 503, retryable: true });
  });

  it("tags statements with the client and per-call query tag and timeout", async () => {
    const f = fakeFetch([{ status: 200, body: { data: [["1"]] } }, { status: 200, body: { data: [["1"]] } }]);
    const client = new SqlApiClient({ ...base, queryTag: "bbc-ct", fetch: f.impl });
    await client.query("SELECT 1", [], { queryTag: "analyst:r1", timeoutS: 30 });
    await new SqlApiClient({ ...base, fetch: f.impl }).query("SELECT 1");
    const first = JSON.parse(String(f.calls[0]!.init.body));
    expect(first).toMatchObject({ timeout: 30, parameters: { query_tag: "bbc-ct:analyst:r1" } });
    expect(JSON.parse(String(f.calls[1]!.init.body)).parameters).toBeUndefined();
  });

  it("returns column metadata and decodes SQL API encodings", async () => {
    const rowType = [
      { name: "CASE_ID", type: "TEXT", nullable: false },
      { name: "STATE_VERSION", type: "FIXED", scale: 0 },
      { name: "VALUE_AT_RISK_USD", type: "FIXED", scale: 2 },
      { name: "AWAITING_ME", type: "BOOLEAN" },
      { name: "DEADLINE_TS", type: "TIMESTAMP_TZ" },
      { name: "SNAPSHOT_AT", type: "TIMESTAMP_NTZ" },
      { name: "HARVEST_DATE", type: "DATE" },
      { name: "AWAITING_ROLES", type: "ARRAY" },
      { name: "NOTE", type: "TEXT" },
    ];
    const row = ["CASE-00000017", "3", "21355.00", "true", "1791278100.000000000 1440", "1791271200.500", "20366",
                 '["BBC_SALES_MGR"]', null];
    const f = fakeFetch([
      { status: 200, body: { data: [row], resultSetMetaData: { rowType } } },
      { status: 200, body: { data: [row], resultSetMetaData: { rowType } } },
    ]);
    const client = new SqlApiClient({ ...base, fetch: f.impl });
    const meta = await client.queryWithMeta("SELECT * FROM V");
    expect(meta.columns[1]).toEqual({ name: "STATE_VERSION", type: "fixed", scale: 0, nullable: true });
    expect(meta.rows[0]).toEqual([
      "CASE-00000017", 3, 21355, true, "2026-10-06T09:15:00.000Z", "2026-10-06T07:20:00.500Z", "2025-10-05",
      ["BBC_SALES_MGR"], null,
    ]);
    const [obj] = await client.queryRows("SELECT * FROM V");
    expect(obj).toMatchObject({ case_id: "CASE-00000017", awaiting_me: true, awaiting_roles: ["BBC_SALES_MGR"] });
  });

  it("keeps integers that don't fit a double as text", () => {
    expect(decodeCell("123456789012345678901", { name: "X", type: "fixed", scale: 0, nullable: true })).toBe(
      "123456789012345678901",
    );
    expect(decodeCell("-1.5", { name: "X", type: "timestamp_ntz", scale: 9, nullable: true })).toBe(
      "1969-12-31T23:59:58.500Z",
    );
  });

  it("builds its config from .env names and refuses a missing token", () => {
    const env = { SNOWFLAKE_ACCOUNT: "acct", BBC_INGEST_PAT: "t" };
    expect(sqlApiConfigFromEnv("BBC_INGEST_PAT", "BBC_INGEST", env)).toMatchObject({
      account: "acct",
      token: "t",
      role: "BBC_INGEST",
      database: "BBC_OS",
    });
    expect(() => sqlApiConfigFromEnv("BBC_ENGINE_PAT", "BBC_ENGINE", env)).toThrow(/BBC_ENGINE_PAT/);
  });
});
