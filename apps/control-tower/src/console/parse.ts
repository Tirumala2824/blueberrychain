import { VERBS, type Command, type Verb } from "./grammar";

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string; suggestions: string[] };

/** Split on whitespace, keeping "double quoted" text (with \" escapes) as one token. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;
    if (input[i] === '"') {
      let j = i + 1;
      let text = "";
      while (j < input.length && input[j] !== '"') {
        if (input[j] === "\\" && j + 1 < input.length) j++;
        text += input[j];
        j++;
      }
      if (j >= input.length) throw new Error("unclosed quote");
      tokens.push(text);
      i = j + 1;
    } else {
      let j = i;
      while (j < input.length && !/\s/.test(input[j]!)) j++;
      tokens.push(input.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/** Verbs that start with the word, or failing that, are within two edits of it. */
export function suggestVerbs(word: string): string[] {
  const w = word.toLowerCase();
  const verbs = VERBS.map((v) => v.verb);
  const prefixed = w ? verbs.filter((v) => v.startsWith(w)) : [];
  return (prefixed.length ? prefixed : verbs.filter((v) => distance(v, w) <= 2)).slice(0, 4);
}

const usage = (verb: Verb) => VERBS.find((v) => v.verb === verb)!.usage;
const fail = (error: string, suggestions: string[] = []): ParseResult => ({ ok: false, error, suggestions });

/** Pull `reason "…"` (or a trailing quoted phrase after the ids) out of the arguments. */
function takeReason(args: string[]): { rest: string[]; reason: string | null } {
  const i = args.findIndex((a) => a.toLowerCase() === "reason");
  if (i >= 0) {
    const reason = args.slice(i + 1).join(" ").trim();
    return { rest: args.slice(0, i), reason: reason || null };
  }
  return { rest: args, reason: null };
}

const isApproval = (t: string) => /^APR-\d+$/i.test(t);

export function parseCommand(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return fail("Type a command, or `help`.");
  if (input.startsWith("?")) {
    const question = input.slice(1).trim();
    return question ? { ok: true, command: { verb: "ask", question } } : fail("Ask a question after `?`.");
  }
  let tokens: string[];
  try {
    tokens = tokenize(input);
  } catch (error) {
    return fail(`The command has an ${(error as Error).message}.`);
  }
  const [head = "", ...args] = tokens;
  const verb = head.toLowerCase();
  switch (verb) {
    case "status":
    case "outcome":
    case "policy":
    case "approvals":
    case "export":
      return { ok: true, command: { verb } as Command };
    case "help":
      return { ok: true, command: { verb, topic: args[0]?.toLowerCase() ?? null } };
    case "ask": {
      const question = input.slice(head.length).trim();
      return question ? { ok: true, command: { verb, question } } : fail("Ask a question after `ask`.");
    }
    case "brief": {
      if (!args[0]) return { ok: true, command: { verb, question: null } };
      const m = /^q?([1-6])$/i.exec(args[0]);
      return m ? { ok: true, command: { verb, question: Number(m[1]) } } : fail(`Usage: ${usage("brief")}`);
    }
    case "why":
      return args[0] ? { ok: true, command: { verb, option: args[0] } } : fail(`Usage: ${usage("why")}`);
    case "compare":
      return args.length === 2 ? { ok: true, command: { verb, a: args[0]!, b: args[1]! } } : fail(`Usage: ${usage("compare")}`);
    case "evidence":
      return args[0] ? { ok: true, command: { verb, id: args[0] } } : fail(`Usage: ${usage("evidence")}`);
    case "trace":
      return { ok: true, command: { verb, run: args[0] ?? null } };
    case "exec":
      return { ok: true, command: { verb, mutation: args[0] ?? null } };
    case "ledger": {
      if (!args[0]) return { ok: true, command: { verb, count: null } };
      const n = Number(args[0]);
      return Number.isInteger(n) && n > 0 && n <= 1000 ? { ok: true, command: { verb, count: n } } : fail(`Usage: ${usage("ledger")}`);
    }
    case "verify": {
      let from: number | null = null;
      let to: number | null = null;
      let table: string | null = null;
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === "--table") {
          table = args[++i]?.toUpperCase() ?? null;
          if (!table || !/^[A-Z][A-Z0-9_$]*(\.[A-Z][A-Z0-9_$]*){2}$/.test(table)) return fail("`--table` needs a fully-qualified table, like BBC_OS.SANDBOX.LEDGER_TAMPER.");
        } else {
          const m = /^(\d+)\.\.(\d+)$/.exec(a);
          if (!m) return fail(`Usage: ${usage("verify")}`);
          from = Number(m[1]);
          to = Number(m[2]);
          if (from > to) return fail("The range must run from a lower to a higher sequence number.");
        }
      }
      return { ok: true, command: { verb, from, to, table } };
    }
    case "replay":
      return { ok: true, command: { verb, pack: args[0] ?? null } };
    case "approve": {
      const { rest, reason } = takeReason(args);
      if (rest.length > 1 || (rest[0] && !isApproval(rest[0]))) return fail(`Usage: ${usage("approve")}`);
      return { ok: true, command: { verb, approval: rest[0] ?? null, reason } };
    }
    case "choose": {
      const { rest, reason } = takeReason(args);
      const [option, approval] = rest;
      if (!option || rest.length > 2 || (approval && !isApproval(approval))) return fail(`Usage: ${usage("choose")}`);
      return { ok: true, command: { verb, option, approval: approval ?? null, reason } };
    }
    case "reject": {
      const { rest, reason } = takeReason(args);
      if (rest.length > 1 || (rest[0] && !isApproval(rest[0]))) return fail(`Usage: ${usage("reject")}`);
      return { ok: true, command: { verb, approval: rest[0] ?? null, reason } };
    }
    case "reverse": {
      const { rest, reason } = takeReason(args);
      if (rest.length > 1) return fail(`Usage: ${usage("reverse")}`);
      return { ok: true, command: { verb, rec: rest[0] ?? null, reason } };
    }
    case "stop-dispatch": {
      const { reason } = takeReason(args);
      return { ok: true, command: { verb, reason } };
    }
    default: {
      const suggestions = suggestVerbs(verb);
      return fail(
        `\`${head}\` isn't a command.${suggestions.length ? "" : " Type `help` for the list, or start a metric question with `?`."}`,
        suggestions,
      );
    }
  }
}
