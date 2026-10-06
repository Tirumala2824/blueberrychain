import { SqlApiError, type ContractError } from "@blueberrychain/shared";
import { INTERFACES, type InterfaceName } from "./interfaces.js";

/** The interface isn't in the account yet, or the caller's role isn't granted it (Snowflake 002003). */
export class InterfaceUnavailableError extends Error {
  readonly delivers: string;
  constructor(readonly interfaceName: InterfaceName, cause?: unknown) {
    const delivers = INTERFACES[interfaceName].delivers;
    super(`${interfaceName} is not available to this identity yet (delivered by ${delivers})`, { cause });
    this.name = "InterfaceUnavailableError";
    this.delivers = delivers;
  }
}

/** Data crossing the boundary (either way) is not in the shape its contract promises. Fail closed. */
export class ContractViolationError extends Error {
  constructor(
    readonly interfaceName: InterfaceName,
    readonly schema: string,
    readonly errors: ContractError[],
  ) {
    const first = errors[0];
    super(`${interfaceName}: data violates ${schema}${first ? `: ${first.path} ${first.message}` : ""}`);
    this.name = "ContractViolationError";
  }
}

/** The credential was refused (expired or revoked PAT, wrong role restriction). */
export class AuthError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AuthError";
  }
}

/** Snowflake codes for "does not exist or not authorized" (object / procedure / view). */
const UNAVAILABLE_CODES = new Set(["002003", "002140", "002141"]);

/** Map a SQL API failure onto the app's error vocabulary. */
export function mapSnowflakeError(name: InterfaceName, error: unknown): Error {
  if (error instanceof SqlApiError) {
    if (error.status === 401 || error.status === 403) return new AuthError(`Snowflake refused the credential for ${name}`, error);
    if (error.code && UNAVAILABLE_CODES.has(error.code)) return new InterfaceUnavailableError(name, error);
    if (/does not exist or not authorized/i.test(error.message)) return new InterfaceUnavailableError(name, error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export interface Refusal {
  status: "INVALID" | "DENIED";
  errors: string[];
  code?: string;
}

/** A read the procedure refused (unknown case, a case the role may not see). */
export class RefusedError extends Error {
  constructor(
    readonly interfaceName: InterfaceName,
    readonly refusal: Refusal,
  ) {
    super(`${interfaceName} refused: ${refusal.errors[0] ?? refusal.code ?? refusal.status}`);
    this.name = "RefusedError";
  }
}

export function isRefusal(value: unknown): value is Refusal {
  const v = value as Partial<Refusal> | null;
  return !!v && typeof v === "object" && (v.status === "INVALID" || v.status === "DENIED") && Array.isArray(v.errors);
}
