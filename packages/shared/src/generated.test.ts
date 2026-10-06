/** Guards against drift between the schemas, the generated types and the hand-written constants. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractsDir } from "./contracts.js";
import { DECIDER_KINDS, DECISION_POINTS, LIFECYCLE_STAGES } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const committed = join(here, "generated");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("generated contract types", () => {
  it("match a fresh generation from contracts/schemas", { timeout: 60_000 }, () => {
    const fresh = mkdtempSync(join(tmpdir(), "bbc-types-"));
    try {
      execFileSync(process.execPath, [join(here, "..", "scripts", "generate-types.mjs")], {
        env: { ...process.env, BBC_TYPES_OUT_DIR: fresh },
        stdio: "pipe",
      });
      const rel = (root: string) => listFiles(root).map((f) => relative(root, f)).sort();
      expect(rel(fresh)).toEqual(rel(committed));
      for (const file of rel(committed)) {
        expect(readFileSync(join(fresh, file), "utf-8"), `${file} is stale - run "pnpm generate"`).toBe(
          readFileSync(join(committed, file), "utf-8"),
        );
      }
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("hand-written constants match common.json enums", () => {
  const defs = (JSON.parse(readFileSync(join(contractsDir(), "schemas", "common.json"), "utf-8")) as {
    $defs: Record<string, { enum?: unknown[] }>;
  }).$defs;

  it("lifecycle stages", () => expect([...LIFECYCLE_STAGES]).toEqual(defs["lifecycle_stage"]?.enum));
  it("decision points", () => expect([...DECISION_POINTS]).toEqual(defs["decision_point"]?.enum));
  it("decider kinds", () => expect([...DECIDER_KINDS]).toEqual(defs["decider_kind"]?.enum));
});
