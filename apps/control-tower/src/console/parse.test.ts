import { describe, expect, it } from "vitest";
import { parseCommand, suggestVerbs, tokenize } from "./parse";

const ok = (input: string) => {
  const r = parseCommand(input);
  if (!r.ok) throw new Error(`${input}: ${r.error}`);
  return r.command;
};
const bad = (input: string) => {
  const r = parseCommand(input);
  if (r.ok) throw new Error(`${input} parsed`);
  return r;
};

describe("console parser", () => {
  it("parses every verb", () => {
    expect(ok("status")).toEqual({ verb: "status" });
    expect(ok("brief q4")).toEqual({ verb: "brief", question: 4 });
    expect(ok("brief")).toEqual({ verb: "brief", question: null });
    expect(ok("why OPT-00000105")).toEqual({ verb: "why", option: "OPT-00000105" });
    expect(ok("compare 102 103")).toEqual({ verb: "compare", a: "102", b: "103" });
    expect(ok("evidence EV:DOC:DOC-SFI-044813#pulp_temp_at_loading_c")).toEqual({ verb: "evidence", id: "EV:DOC:DOC-SFI-044813#pulp_temp_at_loading_c" });
    expect(ok("trace")).toEqual({ verb: "trace", run: null });
    expect(ok("ledger 5")).toEqual({ verb: "ledger", count: 5 });
    expect(ok("verify")).toEqual({ verb: "verify", table: null });
    expect(ok("verify --table bbc_os.ledger.t_tamper_clone")).toEqual({ verb: "verify", table: "BBC_OS.LEDGER.T_TAMPER_CLONE" });
    expect(ok("replay")).toEqual({ verb: "replay", pack: null });
    expect(ok("export")).toEqual({ verb: "export" });
    expect(ok('approve reason "matches the brief"')).toEqual({ verb: "approve", approval: null, reason: "matches the brief" });
    expect(ok("approve APR-00000060")).toEqual({ verb: "approve", approval: "APR-00000060", reason: null });
    expect(ok('choose OPT-103 APR-00000061 reason "inspect first"')).toEqual({ verb: "choose", option: "OPT-103", approval: "APR-00000061", reason: "inspect first" });
    expect(ok('reject reason "the junction is closed"')).toEqual({ verb: "reject", approval: null, reason: "the junction is closed" });
    expect(ok('stop-dispatch reason "duplicate reroutes"')).toEqual({ verb: "stop-dispatch", reason: "duplicate reroutes" });
    expect(ok("ask which lots are below 8 days?")).toEqual({ verb: "ask", question: "which lots are below 8 days?" });
    expect(ok("? which carriers held lots")).toEqual({ verb: "ask", question: "which carriers held lots" });
  });

  it("accepts an unquoted reason and quoted text with escapes", () => {
    expect(ok("reject reason window closed")).toEqual({ verb: "reject", approval: null, reason: "window closed" });
    expect(tokenize('approve reason "say \\"no\\" twice"')).toEqual(["approve", "reason", 'say "no" twice']);
  });

  it("rejects malformed commands with usage, and suggests near-miss verbs", () => {
    expect(bad("brief q9").error).toMatch(/Usage: brief/);
    expect(bad("verify 412..447").error).toMatch(/whole table/);
    expect(bad("verify --table entries").error).toMatch(/fully-qualified/);
    expect(bad("approve OPT-1").error).toMatch(/Usage: approve/);
    expect(bad('approve "unclosed').error).toMatch(/unclosed quote/);
    expect(bad("aprove").suggestions).toEqual(["approve"]);
    expect(bad("delete everything").suggestions).toEqual([]);
    expect(suggestVerbs("st")).toEqual(["status", "stop-dispatch"]);
  });

  it("never sends unknown text to Analyst", () => {
    expect(parseCommand("which lots are warm").ok).toBe(false);
  });
});
