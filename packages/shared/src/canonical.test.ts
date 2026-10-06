import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { businessEventKey, canonicalHash, canonicalJson, normalizeTs, telemetryKey } from "./canonical.js";
import { contractsDir } from "./contracts.js";

const vectors = (name: string) => JSON.parse(readFileSync(join(contractsDir(), "vectors", name), "utf-8"));

describe("canonical JSON", () => {
  it("reproduces every cross-language hash vector", () => {
    for (const v of vectors("canonical_hash.json").vectors) {
      expect(canonicalJson(v.input)).toBe(v.canonical);
      expect(canonicalHash(v.input)).toBe(v.sha256);
    }
  });

  it("writes integral numbers as integers and never uses exponents", () => {
    expect(canonicalJson([4200.0, -0, 1e21, 1.5e-10, 123.456, -0.000001])).toBe(
      "[4200,0,1000000000000000000000,0.00000000015,123.456,-0.000001]",
    );
  });

  it("sorts keys by code point and escapes non-ASCII", () => {
    expect(canonicalJson({ "\u{1F600}": 1, "\uFB01": 2, b: "é\n", a: null })).toBe(
      '{"a":null,"b":"\\u00e9\\n","\\ufb01":2,"\\ud83d\\ude00":1}',
    );
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/NaN/);
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
  });
});

describe("idempotency keys", () => {
  it("reproduces the telemetry vectors", () => {
    for (const v of vectors("idempotency.json").telemetry) {
      expect(telemetryKey(v.device_id, v.reading_ts)).toBe(v.key);
    }
  });

  it("reproduces the business-event vectors", () => {
    for (const v of vectors("idempotency.json").business_events) {
      expect(businessEventKey(v.source_system, v.entity_type, v.external_id, v.event_ts)).toBe(v.key);
    }
  });

  it("normalizes offsets and keeps microseconds", () => {
    expect(normalizeTs("2026-10-06T13:25:00.123456+05:30")).toBe("2026-10-06T07:55:00.123456Z");
    expect(normalizeTs("2026-12-31T23:30:00-01:00")).toBe("2027-01-01T00:30:00.000000Z");
    expect(() => normalizeTs("2026-10-06T07:55:00")).toThrow(/offset/);
  });
});
