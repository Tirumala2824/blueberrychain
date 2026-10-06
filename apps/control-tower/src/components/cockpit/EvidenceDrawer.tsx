"use client";

import { useMemo } from "react";
import { evidenceKind, findEvidence, indexEvidence } from "@/domain/evidence";
import { Value } from "@/components/common/Value";
import { useCockpit } from "./context";
import styles from "./EvidenceDrawer.module.css";

/** The fact behind a citation, resolved inside this case's governed view. */
export function EvidenceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { view } = useCockpit();
  const index = useMemo(() => indexEvidence(view), [view]);
  if (!id) return null;
  const hit = findEvidence(view, id, index);
  return (
    <aside className={styles.drawer} aria-label="Cited evidence" data-testid="evidence-drawer">
      <div className={styles.head}>
        <h3>{evidenceKind(id)}</h3>
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close cited evidence">
          Close
        </button>
      </div>
      <p className={`id ${styles.eid}`}>{id}</p>
      {hit ? (
        <>
          <p className={styles.where}>
            {hit.label}, at <span className="id">{hit.pointer}</span> in the case view
          </p>
          <Value value={hit.value} />
        </>
      ) : (
        <p className={styles.missing}>
          Not in this view. The tool that minted this id returned it to the agent run; the run's recorded tool calls carry its hash.
        </p>
      )}
    </aside>
  );
}
