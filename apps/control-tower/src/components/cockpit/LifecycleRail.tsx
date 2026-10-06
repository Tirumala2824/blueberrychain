"use client";

import { COCKPIT_STAGES, type CockpitStage } from "@blueberrychain/shared/cockpit";
import { STAGE_NAMES } from "@/console/templates";
import styles from "./LifecycleRail.module.css";

const HINT: Record<CockpitStage, string> = {
  EVENT: "What the sensors saw",
  ANALYSIS: "Evidence and cause",
  OPTIONS: "Everything we could do",
  DECISION: "What to do, and why",
  APPROVAL: "Who must agree",
  EXECUTION: "What was changed",
  OUTCOME: "What actually happened",
  EVIDENCE: "Proof and audit",
};

/** The case's lifecycle as a numbered sequence: done, current, not yet reached. */
export function LifecycleRail({ current, shown, onSelect }: { current: CockpitStage; shown: CockpitStage; onSelect: (s: CockpitStage) => void }) {
  const at = COCKPIT_STAGES.indexOf(current);
  return (
    <nav className={styles.rail} aria-label="Lifecycle">
      <ol>
        {COCKPIT_STAGES.map((s, i) => {
          const status = i < at ? "done" : i === at ? "current" : "ahead";
          return (
            <li key={s} className={styles[status]}>
              <button type="button" onClick={() => onSelect(s)} aria-current={shown === s ? "step" : undefined} data-testid={`rail-${s}`} data-status={status}>
                <span className={`${styles.n} num`}>{i + 1}</span>
                <span className={styles.name}>{STAGE_NAMES[s]}</span>
                <span className={styles.hint}>{status === "current" ? "The case is here" : HINT[s]}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
