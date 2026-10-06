// Write the synthetic fixture tapes and the contract fixtures cut from them.
// Run: corepack pnpm --filter @blueberrychain/bbc-api build && corepack pnpm --filter @blueberrychain/bbc-api tapes
// The output is committed; packages/bbc-api/src/fixture/tapes.test.ts fails if it drifts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll, serializeFixture, serializeTape } from "../dist/fixture/author/index.js";
import { tapeErrors } from "../dist/fixture/world.js";

const contracts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contracts");
const { tapes, fixtures } = buildAll();

mkdirSync(join(contracts, "tapes"), { recursive: true });
for (const tape of tapes) {
  const errors = tapeErrors(tape);
  if (errors.length) {
    console.error(`tape ${tape.tape} is invalid:\n  ${errors.slice(0, 20).join("\n  ")}`);
    process.exit(1);
  }
  writeFileSync(join(contracts, "tapes", `${tape.tape}.json`), serializeTape(tape));
}
for (const [name, f] of Object.entries(fixtures)) {
  writeFileSync(join(contracts, "fixtures", "api", `${name}.json`), serializeFixture(f));
}
console.log(`wrote ${tapes.length} tapes and ${Object.keys(fixtures).length} contract fixtures`);
