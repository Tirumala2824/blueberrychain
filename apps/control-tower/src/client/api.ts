"use client";

/** The browser's only network access: this server's /api, with the session's CSRF token. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** "delivered by …" when the Snowflake interface doesn't exist yet. */
  get delivers(): string | null {
    return typeof this.detail["delivers"] === "string" ? this.detail["delivers"] : null;
  }
}

let csrf: string | null = null;
export function setCsrf(token: string | null): void {
  csrf = token;
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body["error"] ?? "http"), String(body["message"] ?? res.statusText), body);
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { credentials: "same-origin", cache: "no-store" }));
}

export async function apiSend<T>(method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(csrf ? { "x-bbc-csrf": csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
