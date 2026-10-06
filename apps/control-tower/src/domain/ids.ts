/** Let people type `103` or `OPT-103` for OPT-00000103, but only when that is unambiguous. */

export type IdResolution = { ok: true; id: string } | { ok: false; error: string; candidates: string[] };

export function resolveId(token: string, prefix: string, candidates: readonly string[], noun: string): IdResolution {
  const t = token.trim().toUpperCase();
  const exact = candidates.find((c) => c.toUpperCase() === t);
  if (exact) return { ok: true, id: exact };
  const digits = new RegExp(`^(?:${prefix}-)?0*(\\d+)$`).exec(t)?.[1];
  if (digits !== undefined) {
    const hits = candidates.filter((c) => Number(c.slice(prefix.length + 1)) === Number(digits));
    if (hits.length === 1) return { ok: true, id: hits[0]! };
  }
  return {
    ok: false,
    error: candidates.length ? `There is no ${noun} ${token} on this case.` : `This case has no ${noun}s yet.`,
    candidates: [...candidates],
  };
}
