/**
 * Resolve citations (EV:… evidence ids) to the fact they point at inside the case view.
 * A pure walk over governed data: nothing is looked up anywhere else.
 */

import type { CaseView } from "@blueberrychain/bbc-api";

export interface EvidenceHit {
  evidence_id: string;
  /** JSON Pointer into the case view. */
  pointer: string;
  value: unknown;
  label: string;
}

const escape = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

function labelFor(value: unknown, pointer: string): string {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["label", "name", "claim_key", "holder_party_id", "order_line_id", "site_id", "lot_id", "party_id", "shipment_id"]) {
      if (typeof v[key] === "string") return String(v[key]);
    }
  }
  return pointer.split("/").filter(Boolean).slice(-2).join(" / ");
}

/** Every object in the view that carries an evidence_id, keyed by that id. */
export function indexEvidence(view: CaseView): Map<string, EvidenceHit> {
  const out = new Map<string, EvidenceHit>();
  const walk = (node: unknown, pointer: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${pointer}/${i}`));
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const id = obj["evidence_id"];
    if (typeof id === "string" && !out.has(id) && !pointer.endsWith("/viewer")) {
      out.set(id, { evidence_id: id, pointer: pointer || "/", value: node, label: labelFor(node, pointer) });
    }
    for (const [k, v] of Object.entries(obj)) if (k !== "evidence_id") walk(v, `${pointer}/${escape(k)}`);
  };
  walk(view, "");
  return out;
}

function resolvePointer(root: unknown, pointer: string): unknown {
  let node = root;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (node === null || typeof node !== "object") return undefined;
    node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Look up one citation; pack citations with a JSON Pointer resolve into the sealed pack. */
export function findEvidence(view: CaseView, evidenceId: string, index = indexEvidence(view)): EvidenceHit | null {
  const direct = index.get(evidenceId);
  if (direct) return direct;
  const m = /^EV:PACK:(PACK-\d+)#(\/.*)$/.exec(evidenceId);
  const pack = view.analysis.pack;
  if (m && pack && pack.pack_id === m[1]) {
    const value = resolvePointer(pack, m[2]!);
    if (value !== undefined) return { evidence_id: evidenceId, pointer: `/analysis/pack${m[2]}`, value, label: labelFor(value, m[2]!) };
  }
  const opt = /^EV:OPT:(OPT-\d+)$/.exec(evidenceId);
  if (opt) {
    const i = view.options.findIndex((o) => o.option_id === opt[1]);
    if (i >= 0) return { evidence_id: evidenceId, pointer: `/options/${i}`, value: view.options[i], label: view.options[i]!.label };
  }
  return null;
}

/** What kind of fact a citation is, in plain words. */
export function evidenceKind(evidenceId: string): string {
  const kind = /^EV:([A-Z]+):/.exec(evidenceId)?.[1];
  return ({
    PACK: "Sealed evidence pack", TEL: "Telemetry window", DOC: "Document claim", SIG: "Causal signature", OPT: "Scored option",
    PREC: "Precedent case", CTR: "Contract term", PARTY: "Party context", RSP: "Counterparty response", MV: "Model validity", LOSS: "Loss basis",
  } as Record<string, string>)[kind ?? ""] ?? "Evidence";
}
