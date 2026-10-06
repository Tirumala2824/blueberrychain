import { validate } from "@blueberrychain/shared";
import { ContractViolationError } from "./errors.js";
import type { InterfaceName } from "./interfaces.js";

/** Return `value` typed as T if it satisfies `schema`; otherwise throw (fail closed). */
export function checked<T>(name: InterfaceName, schema: string, value: unknown): T {
  const errors = validate(schema, value);
  if (errors.length) throw new ContractViolationError(name, schema, errors);
  return value as T;
}
