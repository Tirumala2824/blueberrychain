/** Autocomplete for the console: verbs, then the ids that exist on the loaded case. */

import type { CaseView } from "@blueberrychain/bbc-api";
import { indexEvidence } from "../domain/evidence";
import { VERBS } from "./grammar";

export interface Completion {
  /** The whole input after accepting this completion. */
  value: string;
  label: string;
  hint: string;
}

function idsOf(kind: string, view: CaseView | null): { id: string; hint: string }[] {
  if (!view) return [];
  switch (kind) {
    case "option":
      return view.options.map((o) => ({ id: o.option_id, hint: o.label }));
    case "approval":
      return view.viewer.available_actions
        .filter((a) => a.action === "DECIDE_APPROVAL" && a.approval_id)
        .sort((a, b) => Number(b.enabled) - Number(a.enabled))
        .map((a) => ({ id: a.approval_id!, hint: a.enabled ? `${a.required_role ?? ""}, yours to decide` : (a.disabled_reason ?? "") }));
    case "run":
      return view.agents.runs.map((r) => ({ id: r.run_id, hint: `${r.agent}, ${r.status.toLowerCase()}` }));
    case "mutation":
      return view.execution.mutations.map((m) => ({ id: m.mutation_id, hint: `${m.action_type}, ${m.status.toLowerCase()}` }));
    case "pack":
      return view.analysis.packs.map((p) => ({ id: p.pack_id, hint: `${p.decision_point} revision ${p.revision}` }));
    case "rec":
      return view.decision.recommendations.map((r) => ({ id: r.rec_id, hint: `${r.decided_by}, ${r.status.toLowerCase()}` }));
    case "evidence":
      return [...indexEvidence(view).values()].map((h) => ({ id: h.evidence_id, hint: h.label }));
    default:
      return [];
  }
}

export function complete(input: string, view: CaseView | null, limit = 8): Completion[] {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const endsWithSpace = /\s$/.test(input);
  if (tokens.length <= 1 && !endsWithSpace) {
    const w = (tokens[0] ?? "").toLowerCase();
    return VERBS.filter((v) => v.verb.startsWith(w))
      .slice(0, limit)
      .map((v) => ({ value: `${v.verb} `, label: v.usage, hint: v.summary }));
  }
  const verb = VERBS.find((v) => v.verb === tokens[0]!.toLowerCase());
  if (!verb?.completes) return [];
  const argIndex = endsWithSpace ? tokens.length - 1 : tokens.length - 2;
  const kind = verb.completes[argIndex];
  if (!kind) return [];
  const partial = endsWithSpace ? "" : (tokens.at(-1) ?? "").toUpperCase();
  const prefix = (endsWithSpace ? tokens : tokens.slice(0, -1)).join(" ");
  return idsOf(kind, view)
    .filter((x) => x.id.toUpperCase().includes(partial))
    .slice(0, limit)
    .map((x) => ({ value: `${prefix} ${x.id} `, label: x.id, hint: x.hint }));
}
