"use client";

import { useEffect, useState } from "react";
import type { CaseView } from "@blueberrychain/bbc-api";
import { Cite } from "@/components/common/bits";
import { utcSeconds } from "@/domain/format";
import { panel } from "./ui";
import styles from "./AgentRuns.module.css";

type Run = CaseView["agents"]["runs"][number];
type TraceEvent = Run["trace"][number];

const AGENT_NAME: Record<string, string> = {
  EXCURSION_FORENSICS: "Excursion Forensics",
  RECOVERY_STRATEGIST: "Recovery Strategist",
  CLAIMS_RECOVERY: "Claims & Recovery",
  EVIDENCE_AUDITOR: "Evidence Integrity Auditor",
};
export const agentName = (a: string) => AGENT_NAME[a] ?? a;

function EventRow({ e, onCite }: { e: TraceEvent; onCite: (id: string) => void }) {
  return (
    <li className={styles[`k${e.kind}`]}>
      <span className={`num ${styles.t}`}>{utcSeconds(e.at)}</span>
      <span className={styles.kind}>
        {e.kind === "TOOL_USE" ? "Calls" : e.kind === "TOOL_RESULT" ? "Result" : e.kind === "THINKING" ? "Thinking" : e.kind === "TEXT" ? "Writes" : e.kind === "DONE" ? "Done" : e.kind === "ERROR" ? "Error" : "Status"}
      </span>
      <span className={styles.body}>
        {e.tool && <span className="id">{e.tool.name}</span>}
        {e.tool_result && (
          <>
            <span className={styles.status}>{e.tool_result.status.toLowerCase()}</span>
            {e.tool_result.evidence_ids.map((id) => <Cite key={id} id={id} onOpen={onCite} />)}
          </>
        )}
        {e.text && <span className={e.kind === "TEXT" ? styles.agentWords : undefined}>{e.text}</span>}
        {e.error && <span className={styles.err}>{e.error.message}</span>}
      </span>
    </li>
  );
}

/** A running agent's trace, streamed from the engine (live and unrecorded). */
function LiveTrace({ run, caseId, onCite }: { run: Run; caseId: string; onCite: (id: string) => void }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setEvents([]);
    const es = new EventSource(`/api/runs/${run.run_id}/trace?case=${caseId}`);
    es.addEventListener("agent.trace", (m) => setEvents((prev) => [...prev, JSON.parse((m as MessageEvent).data) as TraceEvent]));
    es.addEventListener("agent.unavailable", (m) => {
      setNote((JSON.parse((m as MessageEvent).data) as { message: string }).message);
      es.close();
    });
    es.addEventListener("agent.end", () => es.close());
    return () => es.close();
  }, [run.run_id, caseId]);
  return (
    <div className={styles.live} data-testid={`live-trace-${run.run_id}`}>
      <p className={styles.liveNote}>Live and unrecorded. The recorded trace replaces this when the run ends.</p>
      {note && <p className={styles.liveNote}>{note}</p>}
      <ol className={styles.events} aria-live="polite">
        {events.map((e) => <EventRow key={e.seq} e={e} onCite={onCite} />)}
      </ol>
    </div>
  );
}

export function AgentRun({ run, caseId, onCite }: { run: Run; caseId: string; onCite: (id: string) => void }) {
  const tone = run.status === "COMPLETED" ? panel.good : run.status === "STARTED" ? panel.info : panel.bad;
  return (
    <article className={styles.run} data-testid={`agent-run-${run.run_id}`}>
      <header className={styles.head}>
        <h4>{agentName(run.agent)}</h4>
        <span className={`${panel.pill} ${tone}`}>{run.status === "STARTED" ? "running" : run.status.toLowerCase()}</span>
        <span className="faint">
          <span className="id">{run.run_id}</span>, {run.model} via {run.provider}, spec v{run.spec_version}, {run.calls_used} of {run.call_budget} tool calls
        </span>
      </header>
      {run.status === "STARTED" ? (
        <LiveTrace run={run} caseId={caseId} onCite={onCite} />
      ) : (
        <ol className={styles.events}>
          {run.trace.map((e) => <EventRow key={e.seq} e={e} onCite={onCite} />)}
          {run.trace_truncated && <li className="faint">The recorded trace was truncated.</li>}
        </ol>
      )}
    </article>
  );
}

export function AgentRuns({ runs, caseId, onCite, agents }: { runs: Run[]; caseId: string; onCite: (id: string) => void; agents?: string[] }) {
  const shown = agents ? runs.filter((r) => agents.includes(r.agent)) : runs;
  if (!shown.length) return null;
  return (
    <div className={styles.runs}>
      {shown.map((r) => <AgentRun key={r.run_id} run={r} caseId={caseId} onCite={onCite} />)}
    </div>
  );
}
