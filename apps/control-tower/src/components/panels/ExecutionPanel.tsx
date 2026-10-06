"use client";

import { useCockpit } from "@/components/cockpit/context";
import { humanizeCode } from "@/console/templates";
import { MutationCard } from "./MutationCard";
import { KV, NotYet, PanelTitle, Section, panel } from "./ui";

export function ExecutionPanel() {
  const { view, prefill } = useCockpit();
  const { plans, mutations } = view.execution;
  const reverse = view.viewer.available_actions.find((a) => a.action === "REVERSE_DECISION");
  if (!mutations.length) {
    return (
      <>
        <PanelTitle title="Execution" />
        <NotYet>Nothing has been sent to the mutation gateway. It only executes what policy and the approvers have authorized.</NotYet>
      </>
    );
  }
  return (
    <>
      <PanelTitle
        title="Execution"
        lead="Every change to SAP, the carrier TMS, carriers and customers goes through one gateway: checked before, sent once with an idempotency key, read back after."
      >
        {reverse && (
          reverse.enabled ? (
            <button type="button" className={panel.btnDanger} onClick={() => prefill(`reverse ${reverse.rec_id ?? ""} reason "`)}>
              Reverse this decision…
            </button>
          ) : (
            <span className={panel.note}>{reverse.disabled_reason}</span>
          )
        )}
      </PanelTitle>
      {plans.map((p) => (
        <Section key={p.plan_id} title={`Plan ${p.plan_id}`} id={`plan-${p.plan_id}`} aside={`${humanizeCode(p.atomicity).toLowerCase()}, ${p.status.toLowerCase()}`}>
          <KV
            items={[
              ["Steps", String(p.steps.length)],
              ["If a step fails", p.atomicity === "ALL_OR_NOTHING" ? "Completed steps are compensated" : "Completed steps stay; the case escalates"],
            ]}
          />
          {mutations.filter((m) => m.plan_id === p.plan_id).sort((a, b) => (a.step_seq ?? 0) - (b.step_seq ?? 0)).map((m) => <MutationCard key={m.mutation_id} m={m} />)}
        </Section>
      ))}
      {mutations.some((m) => !m.plan_id) && (
        <Section title="Other actions" id="other-actions">
          {mutations.filter((m) => !m.plan_id).map((m) => <MutationCard key={m.mutation_id} m={m} />)}
        </Section>
      )}
    </>
  );
}
