/** Read-only OData v2 client for S/4HANA: Basic auth, SAP's d.results envelope, __next paging. */

export interface ODataConfig {
  /** e.g. http://127.0.0.1:4004/sap/opu/odata/sap */
  baseUrl: string;
  user: string;
  password: string;
  fetch?: typeof fetch;
}

export class ODataError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ODataError";
  }

  /** Server-side and throttling errors are worth a retry; 4xx are not. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface ODataPage {
  rows: Record<string, unknown>[];
  /** The server's clock (HTTP Date header) when it answered. */
  serverTime: Date;
}

export class ODataClient {
  private readonly fetchImpl: typeof fetch;
  private readonly auth: string;

  constructor(private readonly config: ODataConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.auth = "Basic " + Buffer.from(`${config.user}:${config.password}`).toString("base64");
  }

  /** Every row of a collection query, following server-driven paging. */
  async getAll(service: string, set: string, query: Record<string, string>): Promise<ODataPage> {
    let url: string | null = `${this.config.baseUrl}/${service}/${set}?${new URLSearchParams({ ...query, $format: "json" })}`;
    const rows: Record<string, unknown>[] = [];
    let serverTime = new Date();
    while (url) {
      const response = await this.fetchImpl(url, { headers: { Authorization: this.auth, Accept: "application/json" } });
      const text = await response.text();
      if (!response.ok) {
        let message = text;
        try {
          message = (JSON.parse(text) as { error?: { message?: { value?: string } } }).error?.message?.value ?? text;
        } catch {
          // not JSON: keep the raw text
        }
        throw new ODataError(response.status, `${service}/${set}: HTTP ${response.status} ${message}`);
      }
      const date = response.headers.get("date");
      if (date) serverTime = new Date(date);
      const body = JSON.parse(text) as { d: { results: Record<string, unknown>[]; __next?: string } };
      rows.push(...body.d.results);
      url = body.d.__next ?? null;
    }
    return { rows, serverTime };
  }
}

const DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;

/** Edm.DateTime / Edm.DateTimeOffset ("/Date(ms)/") -> ISO-8601 UTC, or null. */
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const m = DATE.exec(String(value));
  if (!m) throw new Error(`not an OData date: ${String(value)}`);
  return new Date(Number(m[1])).toISOString();
}

/** Edm.Decimal (a string on the wire) -> number, or null. */
export function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`not a decimal: ${String(value)}`);
  return n;
}

/** ISO cursor -> the datetimeoffset literal SAP's $filter expects. */
export function datetimeoffset(iso: string): string {
  return `datetimeoffset'${new Date(iso).toISOString()}'`;
}
