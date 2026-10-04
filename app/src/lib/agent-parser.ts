// =====================================================================
// BlueberryChain OS - agent envelope parser
//
// DATA_AGENT_RUN returns the full event stream: thinking, tool_use,
// tool_result, text, chart and suggested_queries blocks. This module
// turns that into a typed, renderable timeline for the premium UI.
//
// Design rules:
// - Only the whitelisted ACTION_TOOLS reach the user-facing timeline.
//   The Analyst tool and its internal system_execute_sql steps (which
//   retry and can transiently report errors) are read machinery, not
//   user-visible actions.
// - Chart blocks carry a full Vega-Lite spec (chart_spec string) with
//   inline data.values; we keep it verbatim for the renderer.
// - Documents: GENERATE_INVOICE and WRITE_CREDIT_NOTE return a real PDF
//   (pdf_b64 / doc_title / doc_summary). We surface them as downloads.
// =====================================================================

export type StepStatus = 'SUCCESS' | 'ERROR' | 'PENDING_APPROVAL' | 'SKIPPED';

export interface MetricChip {
  name: string;
  value: string;
}

export interface TimelineStep {
  toolName: string;
  agentName?: string;
  status: StepStatus;
  decisionId?: string;
  entityType?: string;
  entityId?: string;
  input?: Record<string, unknown>;
  message?: string;
  metrics: MetricChip[];
  isApproval: boolean;
  approvalId?: string;
  estimatedValueUsd?: number;
  thresholdUsd?: number;
}

export interface ArtifactChart {
  toolUseId: string;
  /** Raw Vega-Lite spec object with inline data.values. */
  spec: Record<string, unknown>;
}

export interface ArtifactDocument {
  kind: 'invoice' | 'credit_note' | 'settlement' | 'other';
  id: string;
  title: string;
  summary: string;
  pdfB64: string;
  amountUsd?: number;
  entityId?: string;
}

export interface ParsedAgentRun {
  /** Concatenated assistant text (for streaming / typewriter). */
  text: string;
  /** Ordered steps for the action timeline. */
  steps: TimelineStep[];
  /** Charts emitted by the data_to_chart tool. */
  charts: ArtifactChart[];
  /** Downloadable documents produced by the Finance tools. */
  documents: ArtifactDocument[];
  /** Clickable follow-up suggestions. */
  suggestedQueries: string[];
  /** Tool results that queued for human approval. */
  pendingApprovals: TimelineStep[];
  model?: string;
  threadId?: string;
  /** Whether the run surfaced at least one error. */
  hadError: boolean;
}

// State-changing custom tools. Only these appear in the user timeline.
const ACTION_TOOLS = new Set([
  'HOLD_LOT',
  'RELEASE_LOT',
  'DIVERT_LOT',
  'UPDATE_ATP',
  'ADJUST_ORDER_PROMISE',
  'GENERATE_INVOICE',
  'WRITE_CREDIT_NOTE',
  'CALCULATE_TRUE_LANDED_COST',
  'CREATE_PO',
  'CREATE_HARVEST_REQUEST',
  'SEND_NOTIFICATION',
  'APPROVE_ACTION',
  'REJECT_ACTION',
  'DECIDE_APPROVAL',
  'GET_DOCUMENT_LINKS',
]);

// Human-readable agent attribution per tool, matching the orchestration.
const TOOL_AGENT: Record<string, string> = {
  HOLD_LOT: 'Quality Gate',
  RELEASE_LOT: 'Quality Gate',
  DIVERT_LOT: 'Cold Chain & Logistics',
  UPDATE_ATP: 'Inventory & ATP',
  ADJUST_ORDER_PROMISE: 'Order Promise & Fulfillment',
  GENERATE_INVOICE: 'Finance & Billing',
  WRITE_CREDIT_NOTE: 'Finance & Billing',
  CALCULATE_TRUE_LANDED_COST: 'Finance & Billing',
  CREATE_PO: 'Procurement & Sourcing',
  CREATE_HARVEST_REQUEST: 'Harvest Intelligence',
  SEND_NOTIFICATION: 'Supervisor',
  APPROVE_ACTION: 'Supervisor',
  REJECT_ACTION: 'Supervisor',
  DECIDE_APPROVAL: 'Supervisor',
  GET_DOCUMENT_LINKS: 'Finance & Billing',
};

const TOOL_LABEL: Record<string, string> = {
  HOLD_LOT: 'Placed lot on quality hold',
  RELEASE_LOT: 'Released lot from hold',
  DIVERT_LOT: 'Diverted lot to alternate destination',
  UPDATE_ATP: 'Recalculated quality-adjusted ATP',
  ADJUST_ORDER_PROMISE: 'Reassessed order promise',
  GENERATE_INVOICE: 'Generated customer invoice',
  WRITE_CREDIT_NOTE: 'Raised credit note',
  CALCULATE_TRUE_LANDED_COST: 'Restated True Landed Cost',
  CREATE_PO: 'Raised replacement purchase order',
  CREATE_HARVEST_REQUEST: 'Raised replacement harvest request',
  SEND_NOTIFICATION: 'Notified stakeholder',
  APPROVE_ACTION: 'Approved queued action',
  REJECT_ACTION: 'Rejected queued action',
  DECIDE_APPROVAL: 'Recorded approval decision',
  GET_DOCUMENT_LINKS: 'Published document download links',
};

const PENDING = '__pending__';

type Block = Record<string, any>;

function toMetrics(snapshot: unknown): MetricChip[] {
  if (!snapshot) return [];
  let obj: Record<string, unknown> | null = null;
  if (typeof snapshot === 'string') {
    try {
      obj = JSON.parse(snapshot);
    } catch {
      return [];
    }
  } else if (typeof snapshot === 'object') {
    obj = snapshot as Record<string, unknown>;
  }
  if (!obj) return [];

  const out: MetricChip[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'semantic_view' || k === 'read_at') continue;
    if (v === null || v === undefined) continue;
    out.push({ name: k, value: String(v) });
  }
  return out;
}

function classifyDocument(
  toolName: string,
  out: Record<string, any>,
): ArtifactDocument | null {
  const pdfB64: string | undefined = out.pdf_b64;
  if (!pdfB64) return null;

  const kind: ArtifactDocument['kind'] =
    toolName === 'GENERATE_INVOICE'
      ? 'invoice'
      : toolName === 'WRITE_CREDIT_NOTE'
        ? 'credit_note'
        : 'other';

  return {
    kind,
    id: out.invoice_id ?? out.credit_note_id ?? 'doc',
    title: out.doc_title ?? (out.invoice_id ?? out.credit_note_id ?? 'Document'),
    summary: out.doc_summary ?? '',
    pdfB64,
    amountUsd: out.net_amount_usd ?? out.amount_usd,
    entityId: out.shipment_id ?? out.lot_id,
  };
}

/**
 * Parse the raw DATA_AGENT_RUN JSON (array of assistant events) into a
 * renderable run. Accepts the already-JSON.parsed value or a string.
 */
export function parseAgentRun(raw: unknown): ParsedAgentRun {
  let events: Block[] = [];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      events = Array.isArray(p) ? p : [p];
    } catch {
      events = [];
    }
  } else if (Array.isArray(raw)) {
    events = raw as Block[];
  } else if (raw && typeof raw === 'object') {
    events = [raw as Block];
  }

  const texts: string[] = [];
  const steps: TimelineStep[] = [];
  const charts: ArtifactChart[] = [];
  const documents: ArtifactDocument[] = [];
  const suggested: string[] = [];
  const pendingApprovals: TimelineStep[] = [];

  const pendingInputs = new Map<string, { name: string; input: any }>();
  let model: string | undefined;
  let threadId: string | undefined;
  let hadError = false;

  const visit = (blocks: Block[]) => {
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;

      if (b.type === 'text' && typeof b.text === 'string') {
        const t = b.text.trim();
        if (t) texts.push(t);
      }

      if (b.type === 'tool_use' && b.tool_use) {
        const tu = b.tool_use;
        if (tu.tool_use_id) {
          pendingInputs.set(tu.tool_use_id, { name: tu.name, input: tu.input });
        }
      }

      if (b.type === 'chart' && b.chart?.chart_spec) {
        let spec: Record<string, unknown> | null = null;
        try {
          spec =
            typeof b.chart.chart_spec === 'string'
              ? JSON.parse(b.chart.chart_spec)
              : b.chart.chart_spec;
        } catch {
          spec = null;
        }
        if (spec) {
          charts.push({ toolUseId: b.chart.tool_use_id ?? '', spec });
        }
      }

      if (b.type === 'suggested_queries' && Array.isArray(b.suggested_queries)) {
        for (const q of b.suggested_queries) {
          if (q?.query) suggested.push(q.query);
        }
      }

      if (b.type === 'tool_result' && b.tool_result) {
        const tr = b.tool_result;
        const matched = tr.tool_use_id ? pendingInputs.get(tr.tool_use_id) : undefined;
        const toolName = tr.name ?? matched?.name ?? 'unknown';
        if (!ACTION_TOOLS.has(toolName)) continue;

        let out: Record<string, any> | undefined;
        const first = Array.isArray(tr.content) ? tr.content[0] : undefined;
        if (first?.json) {
          let j: any = first.json;
          if (typeof j.result === 'string') {
            try {
              j = JSON.parse(j.result);
            } catch {
              /* keep as-is */
            }
          }
          out = j;
        }

        const status: StepStatus =
          tr.status === 'error'
            ? 'ERROR'
            : out?.status === 'PENDING_APPROVAL'
              ? 'PENDING_APPROVAL'
              : out?.status === 'SKIPPED'
                ? 'SKIPPED'
                : 'SUCCESS';
        if (status === 'ERROR') hadError = true;

        const metrics = toMetrics(out?.metrics_used);
        const isApproval = status === 'PENDING_APPROVAL';

        const step: TimelineStep = {
          toolName,
          agentName: TOOL_AGENT[toolName] ?? 'Supervisor',
          status,
          decisionId: out?.decision_id,
          entityType: out?.lot_id
            ? 'LOT'
            : out?.shipment_id
              ? 'SHIPMENT'
              : out?.po_id
                ? 'PO'
                : out?.dc_code
                  ? 'DC'
                  : undefined,
          entityId: out?.lot_id ?? out?.shipment_id ?? out?.po_id ?? out?.dc_code,
          input: matched?.input,
          message: out?.message,
          metrics,
          isApproval,
          approvalId: out?.approval_id,
          estimatedValueUsd: out?.estimated_value_usd ?? out?.amount_usd,
          thresholdUsd: out?.threshold_usd,
        };
        steps.push(step);
        if (isApproval) pendingApprovals.push(step);

        const doc = classifyDocument(toolName, out ?? {});
        if (doc) documents.push(doc);
      }

      if (Array.isArray(b.content)) visit(b.content);
    }
  };

  for (const ev of events) {
    if (Array.isArray(ev?.content)) visit(ev.content);
    const usage = ev?.metadata?.usage?.tokens_consumed?.[0];
    if (usage?.model_name) model = usage.model_name;
    if (ev?.metadata?.thread_id) threadId = String(ev.metadata.thread_id);
  }

  return {
    text: texts.join('\n\n'),
    steps,
    charts,
    documents,
    suggestedQueries: suggested,
    pendingApprovals,
    model,
    threadId,
    hadError,
  };
}

/** Map a tool to its display label. */
export function toolLabel(toolName: string): string {
  return TOOL_LABEL[toolName] ?? toolName;
}

/** Extract the headline canonical metrics from a run for the metric cards. */
export function headlineMetrics(steps: TimelineStep[]): MetricChip[] {
  const want = new Set([
    'SPOILAGE_RISK_SCORE',
    'TEMPERATURE_COMPLIANCE_PCT',
    'SHELF_LIFE_ADJUSTED_OTD',
    'QUALITY_ADJUSTED_FILL_RATE',
    'TRUE_LANDED_COST',
    'LIVE_DOI',
    'ATP_QUALITY_ADJUSTED',
  ]);
  const seen = new Map<string, string>();
  for (const s of steps) {
    for (const m of s.metrics) {
      if (want.has(m.name) && !seen.has(m.name)) seen.set(m.name, m.value);
    }
  }
  return [...seen.entries()].map(([name, value]) => ({ name, value }));
}
