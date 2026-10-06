"use client";

import { COCKPIT_STAGES, cockpitStageOf, type CaseState, type CockpitStage } from "@blueberrychain/shared/cockpit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCaseView, useViewClock } from "@/client/live";
import { useSession } from "@/client/session";
import { Problem } from "@/components/common/Problem";
import { ConsoleDock, type ConsoleHandle } from "@/components/console/ConsoleDock";
import { AnalysisPanel } from "@/components/panels/AnalysisPanel";
import { ApprovalPanel } from "@/components/panels/ApprovalPanel";
import { DecisionPanel } from "@/components/panels/DecisionPanel";
import { EventPanel } from "@/components/panels/EventPanel";
import { EvidencePanel } from "@/components/panels/EvidencePanel";
import { ExecutionPanel } from "@/components/panels/ExecutionPanel";
import { OptionsPanel } from "@/components/panels/OptionsPanel";
import { OutcomePanel } from "@/components/panels/OutcomePanel";
import { CaseHeader } from "./CaseHeader";
import { CockpitContext, type CockpitApi } from "./context";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { LifecycleRail } from "./LifecycleRail";
import styles from "./Cockpit.module.css";

const PANELS: Record<CockpitStage, () => React.ReactElement> = {
  EVENT: () => <EventPanel />,
  ANALYSIS: () => <AnalysisPanel />,
  OPTIONS: () => <OptionsPanel />,
  DECISION: () => <DecisionPanel />,
  APPROVAL: () => <ApprovalPanel />,
  EXECUTION: () => <ExecutionPanel />,
  OUTCOME: () => <OutcomePanel />,
  EVIDENCE: () => <EvidencePanel />,
};

export function Cockpit({ caseId }: { caseId: string }) {
  const { state } = useSession();
  const live = useCaseView(caseId);
  const view = live.data;
  const now = useViewClock(view?.generated_at, live.fetchedAt);
  const current = view ? cockpitStageOf(view.case.state as CaseState) : null;
  const [stage, setStage] = useState<CockpitStage | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const consoleRef = useRef<ConsoleHandle>(null);
  const followed = useRef<string | null>(null);

  // Follow the case to its new stage when it moves, unless the person is browsing another stage.
  useEffect(() => {
    if (!current) return;
    if (stage === null || stage === followed.current) setStage(current);
    followed.current = current;
  }, [current, stage]);

  const run = useCallback((input: string) => consoleRef.current?.run(input), []);
  const prefill = useCallback((input: string) => consoleRef.current?.prefill(input), []);
  const api = useMemo<CockpitApi | null>(
    () => (view ? { view, now, fixture: state?.mode === "fixture", openEvidence: setEvidence, run, prefill, goStage: (s) => setStage(s as CockpitStage) } : null),
    [view, now, state?.mode, run, prefill],
  );

  if (live.error && !view) return <div className={styles.problem}><Problem error={live.error} what={`Case ${caseId}`} /></div>;
  if (!api || !current) return <div className={styles.loading} aria-busy="true">Loading {caseId}…</div>;
  const shown = stage ?? current;

  return (
    <CockpitContext.Provider value={api}>
      <div className={styles.cockpit}>
        <CaseHeader />
        {live.feedError && <p className={styles.feed}>Live updates paused: {live.feedError}</p>}
        <div className={styles.body}>
          <LifecycleRail current={current} shown={shown} onSelect={setStage} />
          <section className={styles.panel} aria-labelledby="stage-title" data-testid={`panel-${shown}`}>
            {COCKPIT_STAGES.includes(shown) && PANELS[shown]()}
          </section>
          <EvidenceDrawer id={evidence} onClose={() => setEvidence(null)} />
        </div>
        <ConsoleDock ref={consoleRef} caseId={caseId} view={view!} onChanged={() => void live.refresh()} />
      </div>
    </CockpitContext.Provider>
  );
}
