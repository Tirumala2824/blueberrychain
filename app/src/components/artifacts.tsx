'use client';

import { useEffect, useRef } from 'react';
import type {
  ArtifactChart,
  ArtifactDocument,
  MetricChip,
  TimelineStep,
} from '@/lib/agent-parser';
import { toolLabel } from '@/lib/agent-parser';

// =====================================================================
// Artifact components for the premium BlueberryChain OS chat.
// All charts render with the bundled vega-embed (no CDN), documents render
// as a real in-app PDF preview, and every metric chip is hoverable to show
// its provenance from the governed semantic view.
// =====================================================================

const SEMANTIC_VIEW = 'BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN';

// ---------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------
const AGENT_META: Record<string, { icon: string; color: string }> = {
  Supervisor: { icon: '\u25C8', color: '#5b8cff' },
  'Cold Chain & Logistics': { icon: '\u2744', color: '#3aa0ff' },
  'Quality Gate': { icon: '\u2713', color: '#ea5455' },
  'Inventory & ATP': { icon: '\u25A4', color: '#a06bff' },
  'Order Promise & Fulfillment': { icon: '\u23F1', color: '#ff9f43' },
  'Finance & Billing': { icon: '\u0024', color: '#28c76f' },
  'Harvest Intelligence': { icon: '\u2738', color: '#e7c542' },
  'Procurement & Sourcing': { icon: '\u21C4', color: '#b98a5e' },
};

// ---------------------------------------------------------------------
// Metric cards
// ---------------------------------------------------------------------

const METRIC_DISPLAY: Record<
  string,
  { label: string; unit: string; good: 'high' | 'low' }
> = {
  SPOILAGE_RISK_SCORE: { label: 'Spoilage Risk', unit: '', good: 'low' },
  TEMPERATURE_COMPLIANCE_PCT: { label: 'Temp Compliance', unit: '%', good: 'high' },
  SHELF_LIFE_ADJUSTED_OTD: { label: 'Shelf-Life OTD', unit: '%', good: 'high' },
  QUALITY_ADJUSTED_FILL_RATE: { label: 'Fill Rate (QA)', unit: '%', good: 'high' },
  TRUE_LANDED_COST: { label: 'True Landed Cost', unit: 'USD', good: 'low' },
  LIVE_DOI: { label: 'Live DOI', unit: 'days', good: 'high' },
  ATP_QUALITY_ADJUSTED: { label: 'ATP (QA)', unit: 'kg', good: 'high' },
};

function riskTone(name: string, value: string): 'ok' | 'warn' | 'bad' {
  const n = parseFloat(value);
  if (isNaN(n)) return 'ok';
  const meta = METRIC_DISPLAY[name];
  if (!meta) return 'ok';
  if (name === 'SPOILAGE_RISK_SCORE') {
    return n >= 60 ? 'bad' : n >= 35 ? 'warn' : 'ok';
  }
  if (meta.good === 'high') return n >= 90 ? 'ok' : n >= 70 ? 'warn' : 'ok';
  return 'ok';
}

export function MetricCards({ metrics }: { metrics: MetricChip[] }) {
  if (!metrics.length) return null;
  return (
    <div className="metric-grid">
      {metrics.map((m) => {
        const meta = METRIC_DISPLAY[m.name] ?? { label: m.name, unit: '', good: 'high' as const };
        const tone = riskTone(m.name, m.value);
        return (
          <div className={`metric-card tone-${tone}`} key={m.name}>
            <div className="metric-label">{meta.label}</div>
            <div className="metric-value">
              {meta.unit === 'USD' ? '$' : ''}
              {Number(m.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              {meta.unit !== 'USD' && meta.unit ? (
                <span className="metric-unit"> {meta.unit}</span>
              ) : null}
            </div>
            <div className="metric-prov" title={`Read from ${SEMANTIC_VIEW} at decision time`}>
              governed - semantic view
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Status card (lot / PO exposure)
// ---------------------------------------------------------------------
export function StatusCard({ step }: { step: TimelineStep }) {
  const tone =
    step.status === 'ERROR'
      ? 'bad'
      : step.status === 'PENDING_APPROVAL'
        ? 'warn'
        : step.toolName === 'HOLD_LOT'
          ? 'bad'
          : 'ok';
  const badge =
    step.toolName === 'HOLD_LOT'
      ? 'ON HOLD'
      : step.toolName === 'RELEASE_LOT'
        ? 'RELEASED'
        : step.toolName === 'DIVERT_LOT'
          ? 'DIVERTED'
          : step.status === 'PENDING_APPROVAL'
            ? 'NEEDS APPROVAL'
            : 'DONE';

  return (
    <div className={`status-card tone-${tone}`}>
      <div className="status-head">
        <span className={`status-badge tone-${tone}`}>{badge}</span>
        <span className="status-entity">
          {step.entityType} {step.entityId}
        </span>
      </div>
      <div className="status-title">{toolLabel(step.toolName)}</div>
      {step.message && <div className="status-msg">{step.message}</div>}
      {!!step.metrics.length && <MetricChips metrics={step.metrics} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Provenance chips
// ---------------------------------------------------------------------
export function MetricChips({ metrics }: { metrics: MetricChip[] }) {
  if (!metrics.length) return null;
  return (
    <div className="chips">
      {metrics.map((m, i) => (
        <span
          className="chip"
          key={`${m.name}-${i}`}
          title={`${m.name} read from ${SEMANTIC_VIEW} at decision time`}
        >
          {m.name} = {m.value}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Vega-Lite chart artifact
// ---------------------------------------------------------------------
export function ArtifactChart({ chart }: { chart: ArtifactChart }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vegaEmbed = (await import('vega-embed')).default;
      if (cancelled || !ref.current) return;
      const spec = { ...chart.spec } as any;
      // Force theme-friendly background + size; never touch the agent's data.
      spec.background = 'transparent';
      spec.width = 'container';
      spec.config = {
        ...(spec.config ?? {}),
        view: { stroke: null },
        font: 'inherit',
      };
      try {
        await vegaEmbed(ref.current, spec, { actions: false });
      } catch {
        /* a malformed spec should never break the chat */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div className="artifact chart-artifact">
      <div className="artifact-head">
        <span className="artifact-kind">Chart</span>
        <span className="artifact-title">
          {String((chart.spec as any)?.title ?? 'Analysis')}
        </span>
      </div>
      <div className="chart-host" ref={ref} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Downloadable document (invoice / credit note)
// ---------------------------------------------------------------------
export function DocumentCard({ doc }: { doc: ArtifactDocument }) {
  const src = `data:application/pdf;base64,${doc.pdfB64}`;
  const kindLabel =
    doc.kind === 'invoice'
      ? 'Customer Invoice'
      : doc.kind === 'credit_note'
        ? 'Credit Note'
        : 'Document';

  function download() {
    const a = document.createElement('a');
    a.href = src;
    a.download = `${doc.id}.pdf`;
    a.click();
  }

  return (
    <div className="artifact doc-artifact">
      <div className="artifact-head">
        <span className={`artifact-kind kind-${doc.kind}`}>{kindLabel}</span>
        <span className="artifact-title">{doc.title}</span>
        {doc.amountUsd != null && (
          <span className="doc-amount">
            ${Number(doc.amountUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      {doc.summary && <div className="doc-summary">{doc.summary}</div>}
      <details className="doc-preview">
        <summary>Preview PDF</summary>
        <iframe className="pdf-frame" src={src} title={doc.title} />
      </details>
      <div className="doc-actions">
        <button className="primary" onClick={download}>
          Download PDF
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Human-in-the-loop approval card
// ---------------------------------------------------------------------
export function ApprovalCard({
  step,
  busy,
  onDecide,
}: {
  step: TimelineStep;
  busy: boolean;
  onDecide: (approvalId: string, decision: 'APPROVE' | 'REJECT') => void;
}) {
  return (
    <div className="artifact approval-artifact">
      <div className="artifact-head">
        <span className="artifact-kind kind-approval">Approval required</span>
        <span className="artifact-title">{toolLabel(step.toolName)}</span>
        <span className="approval-id">{step.approvalId}</span>
      </div>
      <div className="approval-body">
        Queued instead of executed because it exceeds the autonomy threshold
        {step.estimatedValueUsd != null && (
          <>
            {' '}
            - value{' '}
            <strong>
              ${Number(step.estimatedValueUsd).toLocaleString()}
            </strong>
            {step.thresholdUsd != null && (
              <> vs threshold ${Number(step.thresholdUsd).toLocaleString()}</>
            )}
          </>
        )}
        . Nothing has been executed yet.
      </div>
      {!!step.metrics.length && <MetricChips metrics={step.metrics} />}
      <div className="doc-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => step.approvalId && onDecide(step.approvalId, 'APPROVE')}
        >
          Approve and execute
        </button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => step.approvalId && onDecide(step.approvalId, 'REJECT')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Action timeline (collapsible "what happened")
// ---------------------------------------------------------------------
export function Timeline({
  steps,
  expanded,
  onToggle,
}: {
  steps: TimelineStep[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!steps.length) return null;
  const actions = steps.length;
  const approvals = steps.filter((s) => s.status === 'PENDING_APPROVAL').length;

  return (
    <div className="timeline">
      <button className="timeline-head" onClick={onToggle}>
        <span className={`caret ${expanded ? 'open' : ''}`}>&#9656;</span>
        <span>
          {actions} autonomous action{actions !== 1 ? 's' : ''}
          {approvals ? ` - ${approvals} awaiting your approval` : ''}
        </span>
        <span className="timeline-hint">
          {expanded ? 'hide detail' : 'what happened'}
        </span>
      </button>
      {expanded && (
        <div className="timeline-body">
          {steps.map((s, i) => {
            const meta = AGENT_META[s.agentName ?? 'Supervisor'] ?? AGENT_META.Supervisor;
            return (
              <div className="tstep" key={i}>
                <div className="tstep-icon" style={{ color: meta.color }}>
                  {meta.icon}
                </div>
                <div className="tstep-main">
                  <div className="tstep-top">
                    <span className="tstep-tool">{toolLabel(s.toolName)}</span>
                    <span className="tstep-agent">{s.agentName}</span>
                    <span className={`tstep-status st-${s.status.toLowerCase()}`}>
                      {s.status === 'PENDING_APPROVAL'
                        ? 'needs approval'
                        : s.status.toLowerCase()}
                    </span>
                    {s.decisionId && <span className="tstep-id">{s.decisionId}</span>}
                  </div>
                  {s.message && <div className="tstep-msg">{s.message}</div>}
                  {!!s.metrics.length && <MetricChips metrics={s.metrics} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Suggested next-action chips
// ---------------------------------------------------------------------
export function SuggestedChips({
  queries,
  disabled,
  onPick,
}: {
  queries: string[];
  disabled: boolean;
  onPick: (q: string) => void;
}) {
  if (!queries.length) return null;
  return (
    <div className="suggested">
      <div className="suggested-label">Suggested next actions</div>
      <div className="suggested-row">
        {queries.map((q, i) => (
          <button key={i} className="sug-chip" disabled={disabled} onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
