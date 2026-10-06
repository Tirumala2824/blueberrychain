/** Small Web-standard Request/Response helpers shared by the route handlers. */

import {
  AuthError,
  ContractViolationError,
  InterfaceUnavailableError,
  RefusedError,
} from "@blueberrychain/bbc-api";
import type { AppContext } from "./context";
import { SignInError } from "./identity";
import { readCookie, type Session } from "./session";

export function json(ctx: AppContext, status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-bbc-mode": ctx.config.mode, ...headers },
  });
}

export function problem(ctx: AppContext, status: number, error: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json(ctx, status, { error, message, ...extra });
}

/** The failure vocabulary the UI renders: say what happened and what delivers the fix. */
export function errorResponse(ctx: AppContext, error: unknown): Response {
  if (error instanceof InterfaceUnavailableError) {
    return problem(ctx, 503, "interface_unavailable", error.message, { interface: error.interfaceName, delivers: error.delivers });
  }
  if (error instanceof RefusedError) {
    const status = error.refusal.code === "NOT_FOUND" ? 404 : 403;
    return problem(ctx, status, "refused", error.refusal.errors[0] ?? "Snowflake refused the request.", { code: error.refusal.code ?? null });
  }
  if (error instanceof AuthError) return problem(ctx, 502, "snowflake_auth", error.message);
  if (error instanceof ContractViolationError) {
    return problem(ctx, 502, "contract_violation", error.message, { interface: error.interfaceName, schema: error.schema });
  }
  if (error instanceof SignInError) return problem(ctx, error.status, "sign_in_failed", error.message);
  console.error(JSON.stringify({ at: new Date().toISOString(), event: "unhandled_error", message: (error as Error)?.message }));
  return problem(ctx, 500, "internal", "The control tower hit an unexpected error. The server log has the details.");
}

export function sessionOf(ctx: AppContext, req: Request): Session | null {
  return ctx.store.fromCookie(readCookie(req.headers.get("cookie")));
}

export type Guarded = { session: Session } | { response: Response };

/** A signed-in session, or a 401. */
export function requireSession(ctx: AppContext, req: Request): Guarded {
  const session = sessionOf(ctx, req);
  return session ? { session } : { response: problem(ctx, 401, "signed_out", "Sign in to continue.") };
}

/** A signed-in session for a state-changing request: CSRF token and Origin both checked. */
export function requireWrite(ctx: AppContext, req: Request): Guarded {
  const guarded = requireSession(ctx, req);
  if ("response" in guarded) return guarded;
  if (req.headers.get("x-bbc-csrf") !== guarded.session.csrf) {
    return { response: problem(ctx, 403, "csrf", "This request is missing its session token. Reload the page.") };
  }
  const origin = req.headers.get("origin");
  if (origin && !ctx.config.allowedOrigins.includes(origin)) {
    return { response: problem(ctx, 403, "origin", `Requests from ${origin} are not accepted.`) };
  }
  return guarded;
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0]!;
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}
