/**
 * SAP keys -> BlueberryChain ids. Built from the world config by `bbc sim init`
 * (.artifacts/sim/reference/sap_key_map.json); a real deployment supplies the same
 * file from its master data. Batch numbers are lot ids unchanged.
 */

import { readFileSync } from "node:fs";

export interface KeyMap {
  business_partner: Record<string, string>;
  plant: Record<string, string>;
  material: Record<string, string>;
  ship_to: Record<string, string>;
  harvest_block: Record<string, string>;
}

export class MappingError extends Error {
  constructor(
    readonly kind: keyof KeyMap,
    readonly key: string,
  ) {
    super(`no ${kind} mapping for SAP key '${key}'`);
    this.name = "MappingError";
  }
}

export function loadKeyMap(path: string): KeyMap {
  return JSON.parse(readFileSync(path, "utf-8")) as KeyMap;
}

export function mapKey(map: KeyMap, kind: keyof KeyMap, key: unknown): string {
  const id = map[kind][String(key ?? "")];
  if (!id) throw new MappingError(kind, String(key ?? ""));
  return id;
}

/** Plant or ship-to party, whichever the record carries. */
export function siteOf(map: KeyMap, plant: unknown, shipTo: unknown): string {
  if (plant) return mapKey(map, "plant", plant);
  return mapKey(map, "ship_to", shipTo);
}
