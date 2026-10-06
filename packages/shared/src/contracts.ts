/**
 * Decision-contract validation (JSON Schema 2020-12) for TypeScript code.
 *
 * The canonical schemas live in the repo's `contracts/schemas`. A published
 * package carries a copy in `schemas/`; `BBC_CONTRACTS_DIR` overrides both.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

export interface ContractError {
  /** JSON Pointer into the instance. */
  path: string;
  message: string;
  keyword: string;
}

const COMMON = join("schemas", "common.json");

export function contractsDir(): string {
  const override = process.env["BBC_CONTRACTS_DIR"];
  if (override) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    for (const candidate of [dir, join(dir, "contracts")]) {
      if (existsSync(join(candidate, COMMON))) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("contracts/schemas not found; set BBC_CONTRACTS_DIR");
    dir = parent;
  }
}

function listJson(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listJson(full);
    return entry.endsWith(".json") ? [full] : [];
  });
}

interface Loaded {
  ajv: Ajv2020;
  ids: Map<string, string>; // schema name (e.g. "tools/get_precedents.json") -> $id
}

let loaded: Loaded | undefined;

function load(): Loaded {
  if (loaded) return loaded;
  const schemasDir = join(contractsDir(), "schemas");
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  const ids = new Map<string, string>();
  for (const file of listJson(schemasDir).sort()) {
    const schema = JSON.parse(readFileSync(file, "utf-8")) as { $id: string };
    ajv.addSchema(schema);
    ids.set(relative(schemasDir, file).split(sep).join("/"), schema.$id);
  }
  loaded = { ajv, ids };
  return loaded;
}

export function schemaNames(): string[] {
  return [...load().ids.keys()].sort();
}

const compiled = new Map<string, ValidateFunction>();

function validatorFor(name: string): ValidateFunction {
  const cached = compiled.get(name);
  if (cached) return cached;
  const { ajv, ids } = load();
  const id = ids.get(name);
  if (!id) throw new Error(`unknown contract schema: ${name}`);
  const fn = ajv.getSchema(id);
  if (!fn) throw new Error(`schema failed to compile: ${name}`);
  compiled.set(name, fn);
  return fn;
}

/** Every violation of the named contract (empty array = valid). */
export function validate(name: string, instance: unknown): ContractError[] {
  const fn = validatorFor(name);
  if (fn(instance)) return [];
  return (fn.errors ?? []).map((e: ErrorObject) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
    keyword: e.keyword,
  }));
}
