import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalHash, contractsDir } from "@blueberrychain/shared";
import { describe, expect, it } from "vitest";
import { buildAll, serializeFixture, serializeTape } from "./author/index.js";
import { tapeErrors } from "./world.js";

const built = buildAll();
const tapesDir = join(contractsDir(), "tapes");

describe("synthetic tapes", () => {
  it("match a fresh build (run `corepack pnpm --filter @blueberrychain/bbc-api tapes` after changing a scenario)", () => {
    for (const tape of built.tapes) {
      expect(readFileSync(join(tapesDir, `${tape.tape}.json`), "utf-8") === serializeTape(tape), `${tape.tape}.json is stale`).toBe(true);
    }
    for (const [name, f] of Object.entries(built.fixtures)) {
      const committed = readFileSync(join(contractsDir(), "fixtures", "api", `${name}.json`), "utf-8");
      expect(committed === serializeFixture(f), `fixtures/api/${name}.json is stale`).toBe(true);
    }
  });

  for (const tape of built.tapes) {
    describe(tape.tape, () => {
      it("satisfies the tape contract, and every recorded result its call's contract", () => {
        expect(tapeErrors(tape)).toEqual([]);
      });

      it("keeps each frame's ledger slice a valid hash chain", () => {
        for (const frame of tape.frames) {
          for (const { view } of Object.values(frame.cases)) {
            const entries = view.evidence.ledger.entries;
            entries.forEach((e, i) => {
              const header = { seq: e.seq, ts: e.ts, entry_type: e.entry_type, case_id: view.case.case_id, actor: e.actor,
                               record_ref: e.record_ref, payload_hash: e.payload_hash, prev_hash: e.prev_hash };
              expect(canonicalHash(header), `${frame.label} seq ${e.seq}`).toBe(e.entry_hash);
              if (i > 0) expect(e.prev_hash).toBe(entries[i - 1]!.entry_hash);
            });
            expect(view.change_token).toBe(`${view.case.state_version}:${entries.at(-1)?.seq ?? 0}`);
          }
        }
      });

      it("shows every persona the same case, the same change token in the inbox, and their own identity", () => {
        for (const frame of tape.frames) {
          for (const [caseId, entry] of Object.entries(frame.cases)) {
            for (const [persona, viewer] of Object.entries(entry.viewers)) {
              expect(viewer).toMatchObject(tape.personas[persona as keyof typeof tape.personas]!);
              const row = frame.inbox[persona as keyof typeof frame.inbox]!.find((r) => r.case_id === caseId)!;
              expect(row.change_token).toBe(entry.view.change_token);
            }
          }
        }
      });

      it("never moves state backwards except on a recorded branch", () => {
        const versions = tape.frames.map((f) => Object.values(f.cases)[0]!.view.case.state_version);
        const advanced = new Set(tape.responses.map((r) => r.advance_to_frame).filter((x) => x !== null));
        versions.forEach((v, i) => {
          if (i > 0 && v < versions[i - 1]!) expect(advanced.has(i), `frame ${i} goes backwards`).toBe(true);
        });
      });
    });
  }
});
