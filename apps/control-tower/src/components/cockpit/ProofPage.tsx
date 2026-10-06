"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useCaseView, useViewClock } from "@/client/live";
import { useSession } from "@/client/session";
import { Problem } from "@/components/common/Problem";
import { ConsoleDock, type ConsoleHandle } from "@/components/console/ConsoleDock";
import { EvidencePanel } from "@/components/panels/EvidencePanel";
import { CockpitContext, type CockpitApi } from "./context";
import { EvidenceDrawer } from "./EvidenceDrawer";
import styles from "./Cockpit.module.css";

/** The evidence and audit view of one case, full width, with the console for proof commands. */
export function ProofPage({ caseId }: { caseId: string }) {
  const { state } = useSession();
  const live = useCaseView(caseId);
  const view = live.data;
  const now = useViewClock(view?.generated_at, live.fetchedAt);
  const [evidence, setEvidence] = useState<string | null>(null);
  const consoleRef = useRef<ConsoleHandle>(null);
  const run = useCallback((t: string) => consoleRef.current?.run(t), []);
  const prefill = useCallback((t: string) => consoleRef.current?.prefill(t), []);
  const api = useMemo<CockpitApi | null>(
    () => (view ? { view, now, fixture: state?.mode === "fixture", openEvidence: setEvidence, run, prefill, goStage: () => {} } : null),
    [view, now, state?.mode, run, prefill],
  );
  if (live.error && !view) return <div className={styles.problem}><Problem error={live.error} what={`Case ${caseId}`} /></div>;
  if (!api) return <div className={styles.loading} aria-busy="true">Loading {caseId}…</div>;
  return (
    <CockpitContext.Provider value={api}>
      <div className={styles.cockpit}>
        <div className={styles.body} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <section className={styles.panel}>
            <p>
              <Link href={`/cases/${caseId}`}>Back to the case</Link>
            </p>
            <EvidencePanel />
          </section>
          <EvidenceDrawer id={evidence} onClose={() => setEvidence(null)} />
        </div>
        <ConsoleDock ref={consoleRef} caseId={caseId} view={view} onChanged={() => void live.refresh()} />
      </div>
    </CockpitContext.Provider>
  );
}
