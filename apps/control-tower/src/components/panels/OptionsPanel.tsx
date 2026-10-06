"use client";

import { ValueRange } from "@/components/charts/ValueRange";
import { useCockpit } from "@/components/cockpit/context";
import { EliminatedList, OptionTable } from "./OptionParts";
import { NotYet, PanelTitle, Section } from "./ui";

export function OptionsPanel() {
  const { view, openEvidence } = useCockpit();
  const rec = view.decision.recommendations.find((r) => r.status === "ACTIVE");
  const feasible = view.options.filter((o) => o.feasible).sort((a, b) => (a.score.rank ?? 99) - (b.score.rank ?? 99));
  const eliminated = view.options.filter((o) => !o.feasible);
  const doNothing = feasible.find((o) => o.is_default) ?? null;
  if (!view.options.length) {
    return (
      <>
        <PanelTitle title="Options" />
        <NotYet>Options are scored after the evidence pack is sealed and the cause is recorded.</NotYet>
      </>
    );
  }
  return (
    <>
      <PanelTitle
        title="Options"
        lead="Everything the engine could do, scored against doing nothing by seeded simulation. Every number here is the engine's; no AI produced any of them."
      />
      <Section title="What each option is worth" id="values">
        <ValueRange
          rows={feasible.filter((o) => !o.is_default).map((o) => ({
            id: o.option_id,
            label: o.label,
            expected: o.outcome.financial.expected_nrv_usd,
            p10: o.outcome.financial.nrv_p10_usd,
            p90: o.outcome.financial.nrv_p90_usd,
            vsDefault: o.outcome.financial.value_preserved_vs_default_usd,
            rank: o.score.rank,
            recommended: o.option_id === rec?.option_id,
          }))}
          baseline={doNothing ? { label: doNothing.label, expected: doNothing.outcome.financial.expected_nrv_usd } : null}
        />
      </Section>
      <Section title="Feasible options" id="feasible" aside={`Ranked by risk-adjusted value (${feasible[0]?.score.objective_version ?? "objective"})`}>
        <OptionTable options={feasible} recommendedId={rec?.option_id ?? null} onCite={openEvidence} />
      </Section>
      {eliminated.length > 0 && (
        <Section title="Ruled out" id="ruled-out" aside="Hard constraints remove these before anyone can choose them">
          <EliminatedList options={eliminated} onCite={openEvidence} />
        </Section>
      )}
    </>
  );
}
