/** Every contract fixture: valid instances pass, invalid variants fail (same fixtures as Python). */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { contractsDir, schemaNames, validate } from "./contracts.js";

type Json = unknown;
interface InvalidCase {
  why: string;
  base: number;
  set?: Record<string, Json>;
  delete?: string[];
}
interface Fixture {
  schema: string;
  valid: Json[];
  invalid: InvalidCase[];
}

const fixturesDir = join(contractsDir(), "fixtures");

function listJson(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listJson(full);
    return entry.endsWith(".json") ? [full] : [];
  });
}

function parts(pointer: string): string[] {
  return pointer.replace(/^\//, "").split("/").map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function walk(doc: Json, path: string[]): Record<string, Json> | Json[] {
  let node = doc as Record<string, Json> | Json[];
  for (const p of path) node = (Array.isArray(node) ? node[Number(p)] : node[p]) as typeof node;
  return node;
}

function applyPatch(base: Json, set: Record<string, Json> = {}, del: string[] = []): Json {
  const doc = structuredClone(base);
  for (const [pointer, value] of Object.entries(set)) {
    const path = parts(pointer);
    const last = path.pop()!;
    const target = walk(doc, path);
    if (Array.isArray(target)) target[Number(last)] = value;
    else target[last] = value;
  }
  for (const pointer of del) {
    const path = parts(pointer);
    const last = path.pop()!;
    const target = walk(doc, path);
    if (Array.isArray(target)) target.splice(Number(last), 1);
    else delete target[last];
  }
  return doc;
}

const files = listJson(fixturesDir).sort();

describe("contract fixtures", () => {
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(file, "utf-8")) as Fixture;
    const rel = relative(fixturesDir, file).split(sep).join("/");

    fixture.valid.forEach((instance, i) => {
      it(`${rel} valid[${i}] passes`, () => {
        expect(validate(fixture.schema, instance)).toEqual([]);
      });
    });

    fixture.invalid.forEach((c, i) => {
      it(`${rel} invalid[${i}] fails: ${c.why}`, () => {
        const instance = applyPatch(fixture.valid[c.base], c.set, c.delete);
        expect(validate(fixture.schema, instance).length).toBeGreaterThan(0);
      });
    });
  }

  it("every schema except common.json has fixtures", () => {
    const covered = new Set(files.map((f) => (JSON.parse(readFileSync(f, "utf-8")) as Fixture).schema));
    for (const name of schemaNames()) {
      if (name !== "common.json") expect(covered.has(name), `no fixtures for ${name}`).toBe(true);
    }
  });

  it("reports JSON Pointer paths", () => {
    const option = JSON.parse(readFileSync(join(fixturesDir, "option.json"), "utf-8")) as Fixture;
    const bad = applyPatch(option.valid[0], { "/outcome/operational/p_accept": 2 });
    expect(validate("option.json", bad).some((e) => e.path === "/outcome/operational/p_accept")).toBe(true);
  });

  it("rejects unknown schema names", () => {
    expect(() => validate("nope.json", {})).toThrow(/unknown contract schema/);
  });
});
