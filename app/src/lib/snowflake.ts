import snowflake from 'snowflake-sdk';
import { readFileSync, existsSync } from 'node:fs';

// =====================================================================
// Snowflake access layer.
//
// Everything that produces a NUMBER goes through here, because every
// number must originate from the governed semantic view
// BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN (directly, or via a
// tool that read it first). Prisma never computes a supply chain metric.
//
// Credentials are resolved in this order:
//   1. SPCS OAuth token at /snowflake/session/token (when deployed)
//   2. SNOWFLAKE_PASSWORD / SNOWFLAKE_PAT from the environment (local)
// No credential is ever sent to the browser - this module is server only.
// =====================================================================

snowflake.configure({ logLevel: 'ERROR' });

const SPCS_TOKEN_PATH = '/snowflake/session/token';

export const SUPERVISOR_AGENT =
  process.env.BBC_SUPERVISOR_AGENT ??
  'BLUEBERRY_CHAIN.TOOLS.SUPERVISOR_AGENT';

export const SEMANTIC_VIEW =
  'BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN';

function isRunningInSpcs(): boolean {
  return existsSync(SPCS_TOKEN_PATH);
}

function buildConnectionOptions(): snowflake.ConnectionOptions {
  const warehouse = process.env.SNOWFLAKE_WAREHOUSE ?? 'BBC_WH';
  const database = process.env.SNOWFLAKE_DATABASE ?? 'BLUEBERRY_CHAIN';
  const schema = process.env.SNOWFLAKE_SCHEMA ?? 'TOOLS';

  if (isRunningInSpcs()) {
    // Inside SPCS the platform injects an OAuth token for the app's role.
    return {
      account: process.env.SNOWFLAKE_ACCOUNT!,
      host: process.env.SNOWFLAKE_HOST,
      authenticator: 'OAUTH',
      token: readFileSync(SPCS_TOKEN_PATH, 'utf8'),
      warehouse,
      database,
      schema,
    } as snowflake.ConnectionOptions;
  }

  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  const password = process.env.SNOWFLAKE_PASSWORD ?? process.env.SNOWFLAKE_PAT;

  if (!account || !username || !password) {
    throw new Error(
      'Missing Snowflake credentials. Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER and ' +
        'SNOWFLAKE_PASSWORD (or SNOWFLAKE_PAT) in app/.env.local.',
    );
  }

  return {
    account,
    username,
    password,
    // Cortex Agents resolve permissions from the user's DEFAULT role, not
    // the session role. Setting it explicitly keeps local and deployed
    // behaviour identical and avoids the classic "works in Snowsight,
    // fails in the app" failure.
    role: process.env.SNOWFLAKE_ROLE ?? 'ACCOUNTADMIN',
    warehouse,
    database,
    schema,
  };
}

async function withConnection<T>(
  fn: (conn: snowflake.Connection) => Promise<T>,
): Promise<T> {
  const conn = snowflake.createConnection(buildConnectionOptions());

  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });

  try {
    return await fn(conn);
  } finally {
    await new Promise<void>((resolve) => conn.destroy(() => resolve()));
  }
}

export async function query<T = Record<string, unknown>>(
  sqlText: string,
  binds: snowflake.Bind[] = [],
): Promise<T[]> {
  return withConnection(
    (conn) =>
      new Promise<T[]>((resolve, reject) => {
        conn.execute({
          sqlText,
          binds,
          complete: (err, _stmt, rows) =>
            err ? reject(err) : resolve((rows ?? []) as T[]),
        });
      }),
  );
}

// ---------------------------------------------------------------------
// Agent invocation
// ---------------------------------------------------------------------

export interface AgentToolCall {
  toolName: string;
  agentName?: string;
  status: 'SUCCESS' | 'ERROR' | 'PENDING_APPROVAL' | 'SKIPPED';
  input?: unknown;
  output?: unknown;
  decisionId?: string;
  entityType?: string;
  entityId?: string;
}

export interface AgentRunResult {
  /** Concatenated assistant text. */
  text: string;
  /** Flat action timeline (kept for backward compatibility with the route). */
  toolCalls: AgentToolCall[];
  model?: string;
  threadId?: string;
  /** The raw parsed event array - the premium UI parses this into artifacts. */
  raw: unknown;
}

/**
 * Send a natural-language request to the Supervisor Agent.
 *
 * The UI talks ONLY to the Supervisor. It never addresses a specialist
 * agent directly, so every persona goes through the same orchestration
 * and gets the same numbers.
 */
export async function runSupervisorAgent(
  userText: string,
  history: { role: 'user' | 'assistant'; text: string }[] = [],
): Promise<AgentRunResult> {
  const messages = [
    ...history.map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.text }],
    })),
    { role: 'user', content: [{ type: 'text', text: userText }] },
  ];

  const payload = JSON.stringify({ messages });

  const rows = await query<Record<string, string>>(
    `SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(?, ?, TRUE) AS RESP`,
    [SUPERVISOR_AGENT, payload],
  );

  const rawValue = rows[0]?.RESP ?? '[]';
  let parsed: unknown;
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  } catch {
    return { text: String(rawValue), toolCalls: [], raw: rawValue };
  }

  return extractAgentResult(parsed);
}

type ContentBlock = Record<string, any>;

/**
 * The state-changing custom tools. Only these appear in the user-facing
 * action timeline.
 *
 * Everything else the agent emits is read or render machinery - the
 * Analyst tool itself, its internal `system_execute_sql` steps (which
 * retry and can report transient errors that are not user-visible
 * failures), chart rendering and instruction loading. Surfacing those
 * would make a successful run look like it had errors.
 */
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
]);


/**
 * DATA_AGENT_RUN returns the full event stream: thinking blocks, tool_use,
 * tool_result, text, chart and suggested_queries. We keep the assistant
 * text and a flat tool timeline, and discard the thinking blocks.
 */
export function extractAgentResult(parsed: unknown): AgentRunResult {
  const events: ContentBlock[] = Array.isArray(parsed)
    ? (parsed as ContentBlock[])
    : [parsed as ContentBlock];

  const textParts: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  const pendingInputs = new Map<string, { name: string; input: unknown }>();
  let model: string | undefined;
  let threadId: string | undefined;

  const visitContent = (blocks: ContentBlock[]) => {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'text' && typeof block.text === 'string') {
        const t = block.text.trim();
        if (t) textParts.push(t);
      }

      if (block.type === 'tool_use' && block.tool_use) {
        const tu = block.tool_use;
        if (tu.tool_use_id) {
          pendingInputs.set(tu.tool_use_id, {
            name: tu.name,
            input: tu.input,
          });
        }
      }

      if (block.type === 'tool_result' && block.tool_result) {
        const tr = block.tool_result;
        const matched = tr.tool_use_id
          ? pendingInputs.get(tr.tool_use_id)
          : undefined;
        const toolName = tr.name ?? matched?.name ?? 'unknown';

        // Only real actions reach the timeline. Read/render machinery and
        // the Analyst's internal SQL steps are deliberately excluded.
        if (!ACTION_TOOLS.has(toolName)) {
          continue;
        }

        let output: unknown = tr.content;
        const first = Array.isArray(tr.content) ? tr.content[0] : undefined;
        if (first?.json) {
          output = first.json;
          if (typeof first.json.result === 'string') {
            try {
              output = JSON.parse(first.json.result);
            } catch {
              /* leave as-is */
            }
          }
        }

        const out = output as Record<string, any> | undefined;
        const status =
          tr.status === 'error'
            ? 'ERROR'
            : out?.status === 'PENDING_APPROVAL'
              ? 'PENDING_APPROVAL'
              : out?.status === 'SKIPPED'
                ? 'SKIPPED'
                : 'SUCCESS';

        toolCalls.push({
          toolName,
          status,
          input: matched?.input,
          output,
          decisionId: out?.decision_id,
          entityType: out?.lot_id
            ? 'LOT'
            : out?.shipment_id
              ? 'SHIPMENT'
              : out?.po_id
                ? 'PO'
                : undefined,
          entityId:
            out?.lot_id ?? out?.shipment_id ?? out?.po_id ?? out?.dc_code,
        });
      }

      if (Array.isArray(block.content)) visitContent(block.content);
    }
  };

  for (const event of events) {
    if (Array.isArray(event?.content)) visitContent(event.content);
    const usage = event?.metadata?.usage?.tokens_consumed?.[0];
    if (usage?.model_name) model = usage.model_name;
    if (event?.metadata?.thread_id) threadId = String(event.metadata.thread_id);
  }

  return {
    text: textParts.join('\n\n'),
    toolCalls,
    model,
    threadId,
    raw: parsed,
  };
}

// ---------------------------------------------------------------------
// Audit trail + approvals (Snowflake is authoritative)
// ---------------------------------------------------------------------

export async function fetchPendingApprovals() {
  return query(`
    SELECT APPROVAL_ID, THREAD_ID, AGENT_NAME, TOOL_NAME, STATUS,
           ESTIMATED_VALUE_USD, ACTION_PAYLOAD, METRIC_SNAPSHOT, REQUESTED_AT
      FROM BLUEBERRY_CHAIN.AUDIT.APPROVAL_QUEUE
     WHERE STATUS = 'PENDING'
     ORDER BY REQUESTED_AT DESC
  `);
}

export async function fetchDecisionLog(auditThreadId: string) {
  return query(
    `SELECT DECISION_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
            AUTONOMY_LEVEL, APPROVAL_STATUS, METRIC_SNAPSHOT, RESULT_SUMMARY,
            CREATED_AT
       FROM BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      WHERE THREAD_ID = ?
      ORDER BY CREATED_AT`,
    [auditThreadId],
  );
}

/**
 * Fetch audit rows by explicit decision id.
 *
 * Preferred over fetchDecisionLog for provenance mirroring: it does not
 * depend on the agent having echoed our audit thread id into P_THREAD_ID.
 * The decision ids come straight back from each tool result, so this
 * always matches.
 */
export async function fetchDecisionsByIds(decisionIds: string[]) {
  if (decisionIds.length === 0) return [];
  const placeholders = decisionIds.map(() => '?').join(',');
  return query(
    `SELECT DECISION_ID, AGENT_NAME, TOOL_NAME, ENTITY_TYPE, ENTITY_ID,
            AUTONOMY_LEVEL, APPROVAL_STATUS, METRIC_SNAPSHOT, RESULT_SUMMARY
       FROM BLUEBERRY_CHAIN.AUDIT.DECISION_LOG
      WHERE DECISION_ID IN (${placeholders})`,
    decisionIds,
  );
}

export async function approveAction(approvalId: string, note: string) {
  const rows = await query<Record<string, string>>(
    `CALL BLUEBERRY_CHAIN.TOOLS.APPROVE_ACTION(?, ?)`,
    [approvalId, note],
  );
  return rows[0];
}

export async function rejectAction(approvalId: string, note: string) {
  const rows = await query<Record<string, string>>(
    `CALL BLUEBERRY_CHAIN.TOOLS.REJECT_ACTION(?, ?)`,
    [approvalId, note],
  );
  return rows[0];
}
