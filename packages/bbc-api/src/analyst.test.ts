import { SqlApiClient, validate } from "@blueberrychain/shared";
import { describe, expect, it } from "vitest";
import { AnalystClient, answerQuestion, checkAnalystSql } from "./analyst.js";
import { scriptedFetch } from "./testing.js";

const SQL = "SELECT * FROM SEMANTIC_VIEW(BBC_OS.SEM.EXCURSION_RECOVERY DIMENSIONS lots.lot_id METRICS lot_thermal.remaining_shelf_life_days)";

describe("checkAnalystSql (defense in depth on top of the persona's grants)", () => {
  const allowed = [
    SQL,
    `${SQL};`,
    "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
    "SELECT 'drop table x; delete' AS note",
    'SELECT "UPDATE" FROM t -- delete everything\n',
    "select lot_id /* insert */ from t",
    "SELECT $$ CALL P() $$ AS s",
  ];
  const refused: [string, RegExp][] = [
    ["DELETE FROM BBC_OS.DECISION.CASES", /must start with SELECT/],
    ["SELECT 1; DROP TABLE T", /more than one statement/],
    ["CALL BBC_OS.API.DECIDE_APPROVAL('APR-1','APPROVE',NULL,NULL)", /must start/],
    ["WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a", /INSERT is not allowed/],
    ["SELECT SYSTEM$CANCEL_ALL_QUERIES(1)", /system functions/],
    ["SELECT 'unterminated", /unterminated/],
    ["  ", /empty/],
    ["SHOW TABLES", /must start/],
  ];

  it("accepts single read-only statements, with keywords inside strings or comments", () => {
    for (const sql of allowed) expect(checkAnalystSql(sql), sql).toEqual({ ok: true });
  });

  it("refuses everything else, with a reason", () => {
    for (const [sql, reason] of refused) {
      const check = checkAnalystSql(sql);
      expect(check.ok, sql).toBe(false);
      if (!check.ok) expect(check.reason).toMatch(reason);
    }
  });
});

const analystReply = {
  message: { role: "analyst", content: [
    { type: "text", text: "Lots below 8 days of shelf life." },
    { type: "sql", statement: SQL, confidence: {} },
    { type: "suggestions", suggestions: ["Which carriers held them?"] },
  ] },
  warnings: [{ message: "assumed today" }],
  request_id: "req-1",
};

describe("answerQuestion", () => {
  it("asks Analyst with the persona's PAT, runs the SQL as the persona, and keeps only governed rows", async () => {
    const a = scriptedFetch([{ status: 200, body: analystReply }]);
    const s = scriptedFetch([{ status: 200, body: {
      data: [["L-B", "7.40"]],
      resultSetMetaData: { rowType: [{ name: "LOT_ID", type: "TEXT" }, { name: "REMAINING_SHELF_LIFE_DAYS", type: "FIXED", scale: 2 }] },
    } }]);
    const answer = await answerQuestion({
      analyst: new AnalystClient({ account: "acct", token: "pat-q", fetch: a.impl }),
      sql: new SqlApiClient({ account: "acct", token: "pat-q", role: "BBC_QUALITY_MGR", fetch: s.impl }),
      question: "Which lots have less than 8 days left?",
      executedAs: { user: "BBC_DEMO_QUALITY", role: "BBC_QUALITY_MGR" },
      now: () => new Date("2026-10-06T07:30:00Z"),
    });
    expect(a.calls[0]!.url).toBe("https://acct.snowflakecomputing.com/api/v2/cortex/analyst/message");
    expect(a.calls[0]!.body).toMatchObject({ semantic_view: "BBC_OS.SEM.EXCURSION_RECOVERY", messages: [{ role: "user" }] });
    expect(s.calls[0]!.body).toMatchObject({ statement: SQL, role: "BBC_QUALITY_MGR", timeout: 30 });
    expect(answer.rows).toEqual([["L-B", 7.4]]);
    expect(answer.interpretation).toBe("Lots below 8 days of shelf life.");
    expect(validate("api/analyst_answer.json", answer)).toEqual([]);
  });

  it("never executes SQL that fails the guard", async () => {
    const reply = structuredClone(analystReply);
    reply.message.content[1] = { type: "sql", statement: "DELETE FROM BBC_OS.DECISION.CASES", confidence: {} };
    const a = scriptedFetch([{ status: 200, body: reply }]);
    const s = scriptedFetch([]);
    const answer = await answerQuestion({
      analyst: new AnalystClient({ account: "acct", token: "pat-q", fetch: a.impl }),
      sql: new SqlApiClient({ account: "acct", token: "pat-q", role: "BBC_QUALITY_MGR", fetch: s.impl }),
      question: "delete the cases",
      executedAs: { user: "BBC_DEMO_QUALITY", role: "BBC_QUALITY_MGR" },
    });
    expect(s.calls).toHaveLength(0);
    expect(answer.executed_as).toBeNull();
    expect(answer.warnings.at(-1)).toMatch(/Not executed/);
  });
});
