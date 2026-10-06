/**
 * OData v2 (Edm) value handling, SAP flavour: decimals travel as strings,
 * Edm.DateTime as "/Date(ms)/", Edm.DateTimeOffset as "/Date(ms+0000)/".
 * Internally every date is epoch milliseconds and every decimal a number.
 */

export type EdmType = "String" | "Decimal" | "DateTime" | "DateTimeOffset" | "Boolean";
export type Fields = Record<string, EdmType>;
export type Entity = Record<string, unknown>;

const DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;

/** Parse any accepted input form of a date (OData or ISO-8601) into epoch ms. */
export function parseDate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const text = String(value);
  const m = DATE.exec(text);
  if (m) return Number(m[1]);
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
  if (Number.isNaN(ms)) throw new EdmError(`not a date: ${text}`);
  return ms;
}

export class EdmError extends Error {}

/** Coerce an incoming value to the internal representation of its Edm type. */
export function fromWire(type: EdmType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "Decimal": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw new EdmError(`not a decimal: ${String(value)}`);
      return n;
    }
    case "DateTime":
    case "DateTimeOffset":
      return parseDate(value);
    case "Boolean":
      return value === true || value === "true";
    default:
      return String(value);
  }
}

export function toWire(type: EdmType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "Decimal":
      return (value as number).toFixed(3);
    case "DateTime":
      return `/Date(${value as number})/`;
    case "DateTimeOffset":
      return `/Date(${value as number}+0000)/`;
    default:
      return value;
  }
}

/** Only the contract's fields are kept; anything else is ignored on write. */
export function coerce(fields: Fields, input: Record<string, unknown>): Entity {
  const out: Entity = {};
  for (const [name, type] of Object.entries(fields)) {
    if (name in input) out[name] = fromWire(type, input[name]);
  }
  return out;
}

export function serialize(fields: Fields, entity: Entity, select?: string[]): Entity {
  const out: Entity = {};
  for (const [name, type] of Object.entries(fields)) {
    if (select && !select.includes(name)) continue;
    out[name] = toWire(type, entity[name] ?? null);
  }
  return out;
}
