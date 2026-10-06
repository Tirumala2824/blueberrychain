/** Read-only client for the TMS / carrier API (contracts/apis/mock-tms.openapi.yaml). */

export interface TmsConfig {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export class TmsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TmsError";
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export type Json = Record<string, unknown>;

export class TmsClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: TmsConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  async get<T = Json>(path: string, query: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(query).toString();
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const problem = JSON.parse(text) as { title?: string; detail?: string };
        detail = [problem.title, problem.detail].filter(Boolean).join(": ");
      } catch {
        // keep the raw text
      }
      throw new TmsError(response.status, `GET ${path}: HTTP ${response.status} ${detail}`);
    }
    return JSON.parse(text) as T;
  }
}
