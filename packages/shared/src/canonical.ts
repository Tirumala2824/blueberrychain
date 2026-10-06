/**
 * Canonical JSON and hashing - a port of python/bbc_toolkit/src/bbc_toolkit/ledger.py.
 *
 * Rules (identical to the Python module and the Snowflake LEDGER.CANONICAL_HASH UDF):
 * - object keys sorted by Unicode code point, no insignificant whitespace;
 * - strings escaped as JSON with ASCII-only output (non-ASCII as lowercase \uXXXX);
 * - a number with no fractional part is written as an integer (4200.0 -> 4200);
 *   others use the shortest round-trip decimal form without an exponent (1e-7 -> 0.0000001);
 * - NaN and infinities are rejected; undefined is not JSON and is rejected too.
 * contracts/vectors/canonical_hash.json pins the behaviour across languages.
 */

import { createHash } from "node:crypto";

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function quote(text: string): string {
  return JSON.stringify(text).replace(
    /[\u0080-\uffff]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/** Expand JavaScript's exponent notation into a plain decimal string. */
function plainDecimal(text: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!m) return text;
  const [, sign, int, frac = "", exp] = m;
  const digits = int! + frac;
  const point = int!.length + Number(exp);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`.replace(/0+$/, "");
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error("NaN and infinity are not allowed in canonical JSON");
  if (Number.isInteger(value)) return BigInt(value).toString();
  return plainDecimal(String(value));
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return number(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareCodePoints);
    return "{" + keys.map((k) => quote(k) + ":" + canonicalJson(record[k])).join(",") + "}";
  }
  throw new TypeError(`not JSON-serializable: ${typeof value}`);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * Normalize an ISO-8601 timestamp with an offset to `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC),
 * keeping microseconds exactly (a JavaScript Date would drop them).
 */
export function normalizeTs(text: string): string {
  const m = ISO.exec(text);
  if (!m) throw new Error(`timestamp must be ISO-8601 with an offset: ${text}`);
  const [, y, mo, d, h, mi, s, frac = "", zone] = m;
  let offsetMin = 0;
  if (zone!.toUpperCase() !== "Z") {
    const sign = zone!.startsWith("-") ? -1 : 1;
    offsetMin = sign * (Number(zone!.slice(1, 3)) * 60 + Number(zone!.slice(4, 6)));
  }
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMin * 60_000;
  const utc = new Date(ms).toISOString().slice(0, 19); // whole seconds, so no rounding
  return `${utc}.${frac.padEnd(6, "0")}Z`;
}

/** RAW.TELEMETRY idempotency key (python: bbc_toolkit.raw.telemetry_key). */
export function telemetryKey(deviceId: string, readingTs: string): string {
  return canonicalHash({ kind: "TELEMETRY", device_id: deviceId, reading_ts: normalizeTs(readingTs) });
}

/** RAW.BUSINESS_EVENTS idempotency key (python: bbc_toolkit.raw.business_event_key). */
export function businessEventKey(
  sourceSystem: string,
  entityType: string,
  externalId: string,
  eventTs: string,
): string {
  return canonicalHash({
    kind: "BUSINESS_EVENT",
    source_system: sourceSystem,
    entity_type: entityType,
    external_id: externalId,
    version: normalizeTs(eventTs),
  });
}
