/**
 * Webhook signatures (contracts/schemas/connectors/iot_webhook.json):
 * `X-BBC-Signature: v1=<hex HMAC-SHA256(secret, "<X-BBC-Timestamp>.<raw body>")>`.
 * The timestamp is Unix seconds; a request outside the tolerance window is refused,
 * so a captured request cannot be replayed later.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-bbc-timestamp";
export const SIGNATURE_HEADER = "x-bbc-signature";
export const DEFAULT_TOLERANCE_S = 300;

export function sign(secret: string, timestamp: string, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verify(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: string,
  nowS: number = Math.floor(Date.now() / 1000),
  toleranceS: number = DEFAULT_TOLERANCE_S,
): VerifyResult {
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "missing or malformed timestamp" };
  if (Math.abs(nowS - Number(timestamp)) > toleranceS) return { ok: false, reason: "timestamp outside tolerance" };
  if (!signature?.startsWith("v1=")) return { ok: false, reason: "missing or unsupported signature" };
  const expected = Buffer.from(sign(secret, timestamp, body), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
