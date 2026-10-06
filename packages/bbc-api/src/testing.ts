/** Test helpers: a scripted fetch that records every request (no network). */

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown> | null;
}

export type FakeResponse = { status: number; body: unknown; headers?: Record<string, string> } | Error;

export function scriptedFetch(responses: FakeResponse[]) {
  const calls: RecordedCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body;
    calls.push({ url: String(url), init: init ?? {}, body: typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : null });
    const next = responses.shift();
    if (!next) throw new Error("scriptedFetch: no more responses");
    if (next instanceof Error) throw next;
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: next.headers ?? { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, impl };
}

/** A SQL API 200 response whose single VARIANT cell is `value`. */
export const variantCell = (value: unknown) => ({ status: 200, body: { data: [[JSON.stringify(value)]] } });
