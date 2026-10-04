'use client';

import { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import {
  ApprovalCard,
  ArtifactChart,
  DocumentCard,
  MetricCards,
  StatusCard,
  SuggestedChips,
  Timeline,
} from './artifacts';
import { headlineMetrics, parseAgentRun } from '@/lib/agent-parser';
import type {
  ArtifactChart as ChartT,
  ArtifactDocument as DocT,
  TimelineStep,
} from '@/lib/agent-parser';

const SEMANTIC_VIEW = 'BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN';

const PERSONAS = [
  ['LOGISTICS', 'Logistics / Cold Chain'],
  ['RANCH_MANAGER', 'Ranch Manager'],
  ['QUALITY', 'Quality'],
  ['FINANCE', 'Finance'],
  ['SALES', 'Sales'],
  ['EXECUTIVE', 'Executive'],
] as const;

const EXAMPLES = [
  {
    tag: 'Demo 1 - cold chain excursion',
    text: 'Ranch 14 Block 7 Emerald blueberries harvested this morning show 3.8 hours above 1.8 degrees C. Handle it.',
  },
  {
    tag: 'Demo 2 - settle arrivals',
    text: 'Generate final invoices for all blueberry shipments that arrived at Tracy DC yesterday and settle landed cost.',
  },
  {
    tag: 'Costco exposure',
    text: 'Is the Costco Emerald order still coverable and what is our exposure?',
  },
  {
    tag: 'Availability',
    text: 'What is the quality-adjusted ATP and Live DOI for Emerald at Tracy DC?',
  },
];

interface Turn {
  role: 'USER' | 'ASSISTANT';
  content: string;
  steps: TimelineStep[];
  charts: ChartT[];
  documents: DocT[];
  suggestedQueries: string[];
  pendingApprovals: TimelineStep[];
  model?: string;
  latencyMs?: number;
  streaming?: boolean;
}

interface ThreadMeta {
  id: string;
  title: string;
  persona: string;
  updatedAt: string;
  _count?: { messages: number };
}

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<string>('LOGISTICS');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [auditThreadId, setAuditThreadId] = useState<string | undefined>();
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  // Load thread list for the sidebar (persistent conversations)
  useEffect(() => {
    loadThreads();
  }, []);

  async function loadThreads() {
    try {
      const r = await fetch('/api/chat');
      const d = await r.json();
      setThreads(d.threads ?? []);
    } catch {
      /* non-fatal */
    }
  }

  // Elapsed ticker while the agent is working (progress indicator)
  useEffect(() => {
    if (busy) {
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [busy]);

  function newChat() {
    setTurns([]);
    setThreadId(undefined);
    setAuditThreadId(undefined);
    setError(null);
    setExpandedIdx(null);
  }

  // Resume a persisted thread, rebuilding the visual timeline from the
  // stored artifacts. History replay on the server keeps agent context.
  async function loadThread(id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/chat?threadId=${id}`);
      const d = await r.json();
      if (!d.thread) throw new Error('Thread not found');
      setThreadId(d.thread.id);
      setAuditThreadId(d.thread.auditThreadId);
      setPersona(d.thread.persona);
      const rebuilt: Turn[] = (d.thread.messages ?? []).map((m: any) => ({
        role: m.role,
        content: m.content,
        steps: (m.steps ?? []) as TimelineStep[],
        charts: (m.charts ?? []) as ChartT[],
        documents: (m.documents ?? []) as DocT[],
        suggestedQueries: (m.suggestedQueries ?? []) as string[],
        pendingApprovals: [] as TimelineStep[],
        model: m.model,
        latencyMs: m.latencyMs,
      }));
      setTurns(rebuilt);
      // Re-surface approvals still pending on this thread
      const pending: TimelineStep[] = [];
      for (const t of rebuilt) {
        for (const s of t.steps) if (s.isApproval) pending.push(s);
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    setInput('');
    setExpandedIdx(null);
    setTurns((t) => [...t, { role: 'USER', content: text, steps: [], charts: [], documents: [], suggestedQueries: [], pendingApprovals: [] }]);
    setBusy(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona, threadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Agent call failed');

      setThreadId(data.threadId);
      setAuditThreadId(data.auditThreadId);

      // Re-parse to guarantee a typed envelope even if the server already parsed
      const steps: TimelineStep[] = data.steps ?? [];
      const turn: Turn = {
        role: 'ASSISTANT',
        content: data.message.content,
        steps,
        charts: data.charts ?? [],
        documents: data.documents ?? [],
        suggestedQueries: data.suggestedQueries ?? [],
        pendingApprovals: data.pendingApprovals ?? [],
        model: data.message.model,
        latencyMs: data.message.latencyMs,
        streaming: true,
      };
      setTurns((t) => [...t, turn]);
      if (steps.length) setExpandedIdx(turns.length); // auto-expand the new timeline
      loadThreads();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approvalId: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Approval failed');
      // Mark the approval resolved in the timeline
      setTurns((ts) =>
        ts.map((t) => ({
          ...t,
          pendingApprovals: t.pendingApprovals.filter((s) => s.approvalId !== approvalId),
        })),
      );
      setTurns((t) => [
        ...t,
        {
          role: 'ASSISTANT',
          content:
            decision === 'APPROVE'
              ? `Approved **${approvalId}**. The queued action has been executed and recorded in the audit trail.`
              : `Rejected **${approvalId}**. No action was taken.`,
          steps: [],
          charts: [],
          documents: [],
          suggestedQueries: [],
          pendingApprovals: [],
        },
      ]);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      {/* ---------------- sidebar ---------------- */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">&#127810;</div>
          <div>
            <div className="brand-name">BlueberryChain OS</div>
            <div className="brand-sub">autonomous cold chain</div>
          </div>
        </div>

        <button className="new-chat" onClick={newChat} disabled={busy}>
          + New conversation
        </button>

        <div className="sidebar-label">Conversations</div>
        <div className="thread-list">
          {threads.length === 0 && <div className="thread-empty">No conversations yet</div>}
          {threads.map((t) => (
            <button
              key={t.id}
              className={`thread-item ${t.id === threadId ? 'active' : ''}`}
              onClick={() => loadThread(t.id)}
              title={t.title}
            >
              <span className="thread-title">{t.title}</span>
              <span className="thread-meta">
                {t.persona.toLowerCase().replace('_', ' ')}
                {t._count?.messages ? ` - ${t._count.messages}` : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="sv-tag">{SEMANTIC_VIEW}</div>
          <select
            className="persona-select"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            title="Persona labels the thread for the audit trail. Everyone uses the same Supervisor agent."
          >
            {PERSONAS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </aside>

      {/* ---------------- main ---------------- */}
      <main className="main">
        <div className="conversation">
          <div className="inner">
            {turns.length === 0 && (
              <div className="empty">
                <div className="empty-mark">&#127810;</div>
                <h1>How can I help you run the cold chain?</h1>
                <p>
                  One conversation replaces PP, MM, LE/TM, QM, WM/EWM, SD and FI/CO. Describe the
                  situation in plain language - I will plan, act, and show you the governed metric
                  behind every decision.
                </p>
                <div className="examples">
                  {EXAMPLES.map((ex) => (
                    <button key={ex.tag} className="example" onClick={() => send(ex.text)}>
                      <span className="tag">{ex.tag}</span>
                      {ex.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <div className="turn" key={i}>
                {turn.role === 'USER' ? (
                  <div className="turn-user">
                    <div className="who">You</div>
                    <div className="bubble-user">{turn.content}</div>
                  </div>
                ) : (
                  <div className="turn-agent">
                    <div className="who">
                      BlueberryChain OS
                      {turn.model ? ` - ${turn.model}` : ''}
                      {turn.latencyMs ? ` - ${(turn.latencyMs / 1000).toFixed(1)}s` : ''}
                    </div>

                    {/* action timeline */}
                    <Timeline
                      steps={turn.steps}
                      expanded={expandedIdx === i}
                      onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    />

                    {/* headline metric cards */}
                    {!!headlineMetrics(turn.steps).length && (
                      <MetricCards metrics={headlineMetrics(turn.steps)} />
                    )}

                    {/* status cards for holds / PO exposures */}
                    {turn.steps
                      .filter((s) => ['HOLD_LOT', 'RELEASE_LOT', 'DIVERT_LOT'].includes(s.toolName))
                      .map((s, k) => (
                        <StatusCard key={k} step={s} />
                      ))}

                    {/* charts */}
                    {turn.charts.map((c, k) => (
                      <ArtifactChart key={k} chart={c} />
                    ))}

                    {/* downloadable documents */}
                    {turn.documents.map((d, k) => (
                      <DocumentCard key={k} doc={d} />
                    ))}

                    {/* pending approvals */}
                    {turn.pendingApprovals.map((s, k) => (
                      <ApprovalCard key={k} step={s} busy={busy} onDecide={decide} />
                    ))}

                    {/* the answer text, streamed */}
                    <div className="bubble-agent">
                      <StreamingText text={turn.content} instant={!turn.streaming} />
                    </div>

                    {/* suggested next actions */}
                    <SuggestedChips
                      queries={turn.suggestedQueries}
                      disabled={busy}
                      onPick={send}
                    />
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="turn">
                <div className="who">BlueberryChain OS</div>
                <div className="working">
                  <span className="pulse" />
                  <div>
                    <div className="working-title">Coordinating specialist agents</div>
                    <div className="working-sub">
                      Reading the governed semantic view and acting. {elapsed}s
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="turn">
                <div className="error">{error}</div>
              </div>
            )}

            <div ref={bottom} />
          </div>
        </div>

        {/* ---------------- composer ---------------- */}
        <div className="composer">
          <div className="composer-inner">
            <textarea
              value={input}
              placeholder="Describe what you need - for example: Ranch 14 Block 7 shows 3.8 hours above 1.8 C. Handle it."
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              disabled={busy}
            />
            <button className="send" disabled={busy || !input.trim()} onClick={() => send(input)}>
              Send
            </button>
          </div>
          <div className="hint">
            Enter to send, Shift+Enter for a new line. Every figure is read from {SEMANTIC_VIEW}.
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// Typewriter streaming of the final answer (Claude-style).
// The Agents REST call returns a complete response, so we animate the
// text on reveal. Resume/loaded threads render instantly.
// ---------------------------------------------------------------------
function StreamingText({ text, instant }: { text: string; instant: boolean }) {
  const [shown, setShown] = useState(instant ? text : '');

  useEffect(() => {
    if (instant) {
      setShown(text);
      return;
    }
    setShown('');
    let i = 0;
    const total = text.length;
    // reveal in chunks so long answers stay snappy
    const step = Math.max(2, Math.round(total / 120));
    const iv = setInterval(() => {
      i += step;
      setShown(text.slice(0, i));
      if (i >= total) clearInterval(iv);
    }, 16);
    return () => clearInterval(iv);
  }, [text, instant]);

  return <Markdown>{shown}</Markdown>;
}
