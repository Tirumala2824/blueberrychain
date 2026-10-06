/**
 * Minimal Snowflake SQL API client (POST /api/v2/statements) authenticated with a
 * programmatic access token. Used by connectors and the engine; the Python twin is
 * python/blueberrychain/src/blueberrychain/snowcall.py (sqlapi_runner).
 *
 * - Every value is bound as TEXT; procedures that take VARIANT receive JSON strings.
 * - Retries reuse the same requestId with retry=true, so Snowflake executes a
 *   statement at most once even when a response is lost.
 * - 202 responses are polled until the statement finishes; multi-partition results
 *   are fetched in full.
 */

import { randomUUID } from "node:crypto";

export interface SqlApiConfig {
  /** Account identifier, e.g. "pndvhar-pt70809". */
  account: string;
  /** Defaults to `<account>.snowflakecomputing.com`. */
  host?: string;
  /** Programmatic access token (role-restricted). */
  token: string;
  role: string;
  warehouse?: string;
  database?: string;
  /** Server-side statement timeout, seconds. */
  timeoutS?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  /** Base backoff between retries, ms (doubles each attempt, with jitter). */
  backoffMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
}

export class SqlApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
    readonly sqlState?: string,
  ) {
    super(message);
    this.name = "SqlApiError";
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

interface StatementResponse {
  data?: (string | null)[][];
  resultSetMetaData?: { partitionInfo?: unknown[] };
  statementHandle?: string;
  statementStatusUrl?: string;
  code?: string;
  sqlState?: string;
  message?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Bind = string | number | boolean | null | object;

export class SqlApiClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: SqlApiConfig) {
    if (!config.token) throw new Error("SqlApiClient: a programmatic access token is required");
    this.base = `https://${config.host ?? `${config.account}.snowflakecomputing.com`}`;
    this.fetchImpl = config.fetch ?? fetch;
  }

  /** Run one statement and return every row (values as strings, as the SQL API returns them). */
  async query(statement: string, binds: Bind[] = []): Promise<(string | null)[][]> {
    const body = JSON.stringify({
      statement,
      timeout: this.config.timeoutS ?? 120,
      role: this.config.role,
      ...(this.config.warehouse ? { warehouse: this.config.warehouse } : {}),
      ...(this.config.database ? { database: this.config.database } : {}),
      bindings: Object.fromEntries(
        binds.map((value, i) => [String(i + 1), { type: "TEXT", value: toText(value) }]),
      ),
    });
    const requestId = randomUUID();
    let result = await this.withRetries((attempt) =>
      this.send(
        "POST",
        `/api/v2/statements?requestId=${requestId}${attempt > 1 ? "&retry=true" : ""}`,
        body,
      ),
    );
    while (result.status === 202) {
      await sleep(this.config.pollIntervalMs ?? 500);
      const url = result.json.statementStatusUrl ?? `/api/v2/statements/${result.json.statementHandle}`;
      result = await this.withRetries(() => this.send("GET", url));
    }
    const rows = [...(result.json.data ?? [])];
    const partitions = result.json.resultSetMetaData?.partitionInfo?.length ?? 1;
    for (let p = 1; p < partitions; p++) {
      const url = `/api/v2/statements/${result.json.statementHandle}?partition=${p}`;
      const page = await this.withRetries(() => this.send("GET", url));
      rows.push(...(page.json.data ?? []));
    }
    return rows;
  }

  /** Run a CALL whose procedure returns VARIANT and parse its single value as JSON. */
  async callJson<T = Record<string, unknown>>(statement: string, binds: Bind[] = []): Promise<T> {
    const rows = await this.query(statement, binds);
    const cell = rows[0]?.[0];
    if (cell == null) throw new SqlApiError(`no result from: ${statement}`, 200, false);
    return JSON.parse(cell) as T;
  }

  private async withRetries(
    attemptFn: (attempt: number) => Promise<{ status: number; json: StatementResponse }>,
  ) {
    const max = this.config.maxAttempts ?? 5;
    for (let attempt = 1; ; attempt++) {
      try {
        return await attemptFn(attempt);
      } catch (error) {
        const retryable = !(error instanceof SqlApiError) || error.retryable;
        if (!retryable || attempt >= max) throw error;
        const base = (this.config.backoffMs ?? 250) * 2 ** (attempt - 1);
        await sleep(base + Math.random() * base);
      }
    }
  }

  private async send(method: "GET" | "POST", path: string, body?: string) {
    const response = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": this.config.userAgent ?? "blueberrychain/0.1",
      },
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    let json: StatementResponse = {};
    try {
      json = text ? (JSON.parse(text) as StatementResponse) : {};
    } catch {
      json = { message: text };
    }
    if (response.status === 200 || response.status === 202) return { status: response.status, json };
    throw new SqlApiError(
      `SQL API ${response.status}: ${json.message ?? response.statusText}`,
      response.status,
      RETRYABLE_STATUS.has(response.status),
      json.code,
      json.sqlState,
    );
  }
}

function toText(value: Bind): string | null {
  if (value === null) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Client config from the environment variables in .env.example. */
export function sqlApiConfigFromEnv(
  patVar: string,
  role: string,
  env: Record<string, string | undefined> = process.env,
): SqlApiConfig {
  const account = env.SNOWFLAKE_ACCOUNT;
  const token = env[patVar];
  if (!account) throw new Error("SNOWFLAKE_ACCOUNT is not set");
  if (!token) throw new Error(`${patVar} is not set (see .env.example)`);
  return {
    account,
    token,
    role,
    ...(env.SNOWFLAKE_HOST ? { host: env.SNOWFLAKE_HOST } : {}),
    warehouse: env.BBC_APP_WAREHOUSE ?? "BBC_APP_WH",
    database: env.BBC_DATABASE ?? "BBC_OS",
  };
}
