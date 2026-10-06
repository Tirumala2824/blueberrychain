/**
 * Cortex Analyst over the governed semantic view, as the signed-in persona.
 *
 * Analyst turns a question into SQL; the SQL then runs under the persona's own role
 * (no DML grants; the SQL API runs one statement) and only its result rows are shown.
 * `checkAnalystSql` is defense in depth on top of those grants: one read-only statement.
 * Analyst answers are not decision evidence and never feed an approval.
 */

import type { ApiAnalystAnswer, Cell, SqlApiClient } from "@blueberrychain/shared";
import { AuthError, InterfaceUnavailableError, mapSnowflakeError } from "./errors.js";
import type { PersonaRole } from "./interfaces.js";

export type AnalystAnswer = ApiAnalystAnswer.AnalystAnswer;

export const SEMANTIC_VIEW = "BBC_OS.SEM.EXCURSION_RECOVERY";

export interface AnalystConfig {
  account: string;
  host?: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface AnalystReply {
  text: string | null;
  sql: string | null;
  suggestions: string[];
  warnings: string[];
  request_id: string | null;
}

interface AnalystContent {
  type: string;
  text?: string;
  statement?: string;
  suggestions?: string[];
}

export class AnalystClient {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AnalystConfig) {
    if (!config.token) throw new Error("AnalystClient: a programmatic access token is required");
    this.url = `https://${config.host ?? `${config.account}.snowflakecomputing.com`}/api/v2/cortex/analyst/message`;
    this.fetchImpl = config.fetch ?? fetch;
  }

  /** One single-turn question (no conversation state is kept anywhere). */
  async ask(question: string, semanticView = SEMANTIC_VIEW): Promise<AnalystReply> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: question }] }],
        semantic_view: semanticView,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`Cortex Analyst refused the credential (${response.status})`);
    }
    if (response.status === 404 || (response.status === 400 && /does not exist|not authorized/i.test(text))) {
      throw new InterfaceUnavailableError("ANALYST_MESSAGE");
    }
    if (!response.ok) throw new Error(`Cortex Analyst ${response.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text) as {
      message?: { content?: AnalystContent[] };
      warnings?: { message?: string }[];
      request_id?: string;
    };
    const content = json.message?.content ?? [];
    return {
      text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") || null,
      sql: content.find((c) => c.type === "sql")?.statement ?? null,
      suggestions: content.flatMap((c) => (c.type === "suggestions" ? (c.suggestions ?? []) : [])).slice(0, 10),
      warnings: (json.warnings ?? []).map((w) => w.message ?? "").filter(Boolean).slice(0, 20),
      request_id: json.request_id ?? null,
    };
  }
}

const FORBIDDEN = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "CREATE", "ALTER", "DROP", "UNDROP", "GRANT", "REVOKE",
  "CALL", "EXECUTE", "EXEC", "USE", "SET", "UNSET", "PUT", "GET", "COPY", "REMOVE", "LIST", "BEGIN", "START",
  "COMMIT", "ROLLBACK", "SHOW", "DESCRIBE", "DESC", "COMMENT", "REPLACE",
]);

/** Remove string literals, quoted identifiers, dollar-quoted text and comments (keeping word boundaries). */
function stripLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) throw new Error("unterminated comment");
      i = end + 2;
      out += " ";
    } else if (c === "$" && next === "$") {
      const end = sql.indexOf("$$", i + 2);
      if (end === -1) throw new Error("unterminated $$ literal");
      i = end + 2;
      out += " '' ";
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error("unterminated quoted text");
        if (sql[j] === "\\" && c === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      out += c === "'" ? " '' " : " QUOTED_IDENT ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export type SqlCheck = { ok: true } | { ok: false; reason: string };

/** Accept exactly one read-only SELECT / WITH statement. */
export function checkAnalystSql(sql: string): SqlCheck {
  let bare: string;
  try {
    bare = stripLiterals(sql).trim();
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (bare.endsWith(";")) bare = bare.slice(0, -1).trimEnd();
  if (!bare) return { ok: false, reason: "empty statement" };
  if (bare.includes(";")) return { ok: false, reason: "more than one statement" };
  const words = bare.toUpperCase().match(/[A-Z_][A-Z0-9_$]*/g) ?? [];
  if (words[0] !== "SELECT" && words[0] !== "WITH") return { ok: false, reason: `must start with SELECT or WITH, not ${words[0] ?? "?"}` };
  const banned = words.find((w) => FORBIDDEN.has(w));
  if (banned) return { ok: false, reason: `${banned} is not allowed in a read-only question` };
  if (words.some((w) => w.startsWith("SYSTEM$"))) return { ok: false, reason: "system functions are not allowed" };
  return { ok: true };
}

export interface AnswerOptions {
  analyst: AnalystClient;
  sql: SqlApiClient;
  question: string;
  executedAs: { user: string; role: PersonaRole };
  semanticView?: string;
  maxRows?: number;
  timeoutS?: number;
  now?: () => Date;
}

function scalar(cell: Cell): string | number | boolean | null {
  if (cell === null || typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") return cell;
  return JSON.stringify(cell);
}

/** Ask Analyst, check its SQL, run it as the persona, and package the governed rows. */
export async function answerQuestion(options: AnswerOptions): Promise<AnalystAnswer> {
  const semanticView = options.semanticView ?? SEMANTIC_VIEW;
  const maxRows = options.maxRows ?? 1000;
  const reply = await options.analyst.ask(options.question, semanticView);
  const base = {
    question: options.question,
    semantic_view: semanticView,
    interpretation: reply.text,
    sql: reply.sql,
    request_id: reply.request_id,
    suggestions: reply.suggestions,
    executed_at: (options.now?.() ?? new Date()).toISOString(),
  };
  if (!reply.sql) {
    return { ...base, executed_as: null, columns: [], rows: [], row_count: 0, truncated: false, warnings: reply.warnings };
  }
  const check = checkAnalystSql(reply.sql);
  if (!check.ok) {
    return {
      ...base, executed_as: null, columns: [], rows: [], row_count: 0, truncated: false,
      warnings: [...reply.warnings, `Not executed: ${check.reason}`].slice(0, 20),
    };
  }
  let result;
  try {
    result = await options.sql.queryWithMeta(reply.sql, [], {
      queryTag: `analyst:${reply.request_id ?? "local"}`,
      timeoutS: options.timeoutS ?? 30,
    });
  } catch (error) {
    throw mapSnowflakeError("ANALYST_MESSAGE", error);
  }
  return {
    ...base,
    executed_as: { user: options.executedAs.user, role: options.executedAs.role },
    columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
    rows: result.rows.slice(0, maxRows).map((row) => row.slice(0, 100).map(scalar)),
    row_count: result.rows.length,
    truncated: result.rows.length > maxRows,
    warnings: reply.warnings,
  };
}
