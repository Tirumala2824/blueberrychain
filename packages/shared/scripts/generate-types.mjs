// Generate TypeScript types from contracts/schemas into src/generated/.
// Run: corepack pnpm --filter @blueberrychain/shared generate
// The generated files are committed; a test fails if they drift from the schemas.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "..", "..", "contracts", "schemas");
const outDir = process.env.BBC_TYPES_OUT_DIR ?? join(here, "..", "src", "generated");
const ID_PREFIX = "https://blueberrychain.dev/schemas/";

function listJson(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listJson(full);
    return entry.endsWith(".json") ? [full] : [];
  });
}

// Resolve schema $ids (https://blueberrychain.dev/schemas/...) to local files - never the network.
const localResolver = {
  order: 1,
  canRead: (file) => file.url.startsWith(ID_PREFIX),
  read: (file) => readFileSync(join(schemasDir, ...file.url.slice(ID_PREFIX.length).split("#")[0].split("/")), "utf-8"),
};

const banner = "/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */";

rmSync(outDir, { recursive: true, force: true });
const exports = [];
for (const file of listJson(schemasDir).sort()) {
  const rel = relative(schemasDir, file).split(sep).join("/");
  if (rel === "common.json") continue;
  const schema = JSON.parse(readFileSync(file, "utf-8"));
  const ts = await compile(schema, schema.title ?? rel, {
    bannerComment: banner,
    cwd: dirname(file),
    declareExternallyReferenced: true,
    additionalProperties: false,
    $refOptions: { resolve: { blueberrychain: localResolver, http: false } },
    format: true,
  });
  const moduleRel = rel.replace(/\.json$/, "");
  const target = join(outDir, `${moduleRel}.ts`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, ts);
  const ns = moduleRel
    .split("/")
    .map((part) => part.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase()))
    .join("");
  exports.push(`export type * as ${ns} from "./${moduleRel}.js";`);
}
writeFileSync(join(outDir, "index.ts"), `${banner}\n\n${exports.join("\n")}\n`);
console.log(`generated ${exports.length} contract modules into src/generated/`);
