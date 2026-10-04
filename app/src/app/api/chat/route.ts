import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runSupervisorAgent, fetchDecisionsByIds } from '@/lib/snowflake';
import { parseAgentRun } from '@/lib/agent-parser';
import { Persona, MessageRole, ToolCallStatus } from '@prisma/client';

// Agent runs with a full autonomous chain can take minutes.
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

/**
 * The single chat endpoint.
 *
 * Flow:
 *   1. Persist the user turn in Snowflake Postgres via Prisma.
 *   2. Send it to the SUPERVISOR AGENT ONLY. The UI never addresses a
 *      specialist agent, so every persona gets identical orchestration.
 *   3. Parse the raw agent envelope into a typed timeline: action steps,
 *      Vega-Lite charts, downloadable documents, suggested queries and
 *      pending approvals.
 *   4. Persist the assistant turn + artifacts + provenance mirror.
 *   5. Mirror any newly queued approvals.
 *
 * Memory: when a thread is resumed, the full prior history is replayed to
 * the Supervisor so context carries across turns and across sessions.
 */
export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    const body = await req.json();
    const text: string = (body.text ?? '').trim();
    const persona: Persona = body.persona ?? 'LOGISTICS';
    let threadId: string | undefined = body.threadId;

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // 1. Thread + user message
    let thread = threadId
      ? await prisma.thread.findUnique({ where: { id: threadId } })
      : null;

    if (!thread) {
      const auditThreadId = `bbc-${Date.now().toString(36)}`;
      thread = await prisma.thread.create({
        data: { auditThreadId, persona, title: text.slice(0, 80) },
      });
    }
    threadId = thread.id;

    await prisma.message.create({
      data: { threadId, role: MessageRole.USER, content: text },
    });

    // 2. Replay prior turns so the Supervisor keeps conversational context.
    //    This is the in-conversation memory; thread resume adds the prior
    //    turns again from Postgres, giving persistence across sessions.
    const prior = await prisma.message.findMany({
      where: { threadId, role: { in: [MessageRole.USER, MessageRole.ASSISTANT] } },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });
    const history = prior
      .slice(0, -1)
      .map((m) => ({
        role: m.role === MessageRole.USER ? ('user' as const) : ('assistant' as const),
        text: m.content,
      }));

    // The audit thread id is passed in-band so the agent uses it as
    // P_THREAD_ID on every tool call, linking the whole conversation in the
    // Snowflake audit trail.
    const framed =
      `${text}\n\n[system: use P_THREAD_ID = "${thread.auditThreadId}" ` +
      `for every tool call in this conversation]`;

    const result = await runSupervisorAgent(framed, history);
    const latencyMs = Date.now() - started;

    // 3. Parse the raw envelope into a typed timeline + artifacts.
    const parsed = parseAgentRun(result.raw);

    // 4. Assistant message + artifacts
    const assistant = await prisma.message.create({
      data: {
        threadId,
        role: MessageRole.ASSISTANT,
        content: parsed.text || '(no text returned)',
        model: parsed.model ?? result.model,
        latencyMs,
        steps: parsed.steps as any,
        charts: parsed.charts as any,
        documents: parsed.documents as any,
        suggestedQueries: parsed.suggestedQueries as any,
      },
    });

    if (parsed.threadId ?? result.threadId) {
      await prisma.thread.update({
        where: { id: threadId },
        data: { snowflakeThreadId: parsed.threadId ?? result.threadId },
      });
    }

    // Persist the flat tool-call rows for the audit-timeline table and
    // the provenance mirror.
    for (const [i, s] of parsed.steps.entries()) {
      await prisma.toolCall.create({
        data: {
          threadId,
          messageId: assistant.id,
          toolName: s.toolName,
          agentName: s.agentName,
          status: s.status as ToolCallStatus,
          decisionId: s.decisionId,
          entityType: s.entityType,
          entityId: s.entityId,
          input: (s.input ?? null) as any,
          output: ({ message: s.message }) as any,
          sequence: i,
        },
      });
    }

    // Mirror metric provenance from the Snowflake audit trail, matched by
    // decision id so it holds regardless of thread-id plumbing.
    try {
      const decisionIds = parsed.steps
        .map((s) => s.decisionId)
        .filter((d): d is string => !!d);
      const decisions = (await fetchDecisionsByIds(decisionIds)) as any[];
      for (const d of decisions) {
        const call = await prisma.toolCall.findFirst({
          where: { threadId, decisionId: d.DECISION_ID },
        });
        if (!call) continue;
        await prisma.toolCall.update({
          where: { id: call.id },
          data: { agentName: d.AGENT_NAME },
        });
        const snapshot =
          typeof d.METRIC_SNAPSHOT === 'string'
            ? JSON.parse(d.METRIC_SNAPSHOT)
            : d.METRIC_SNAPSHOT;
        if (!snapshot) continue;
        const existing = await prisma.metricProvenance.count({
          where: { toolCallId: call.id },
        });
        if (existing > 0) continue;
        for (const [name, value] of Object.entries(snapshot)) {
          if (name === 'semantic_view' || name === 'read_at') continue;
          if (value === null || value === undefined) continue;
          await prisma.metricProvenance.create({
            data: {
              toolCallId: call.id,
              metricName: name,
              metricValue: String(value),
              semanticView:
                snapshot.semantic_view ??
                'BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN',
            },
          });
        }
      }
    } catch (e) {
      console.error('metric provenance mirror failed', e);
    }

    // 5. Mirror approvals raised during this turn
    for (const s of parsed.pendingApprovals) {
      if (!s.approvalId) continue;
      await prisma.approval.upsert({
        where: { approvalId: s.approvalId },
        update: {},
        create: {
          approvalId: s.approvalId,
          threadId,
          toolName: s.toolName,
          estimatedValueUsd: s.estimatedValueUsd ?? null,
          thresholdUsd: s.thresholdUsd ?? null,
          payload: (s.input ?? null) as any,
          metricSnapshot: (s.metrics.length ? { from: 'metrics_used', items: s.metrics } : null) as any,
        },
      });
    }

    return NextResponse.json({
      threadId,
      auditThreadId: thread.auditThreadId,
      message: {
        id: assistant.id,
        role: 'ASSISTANT',
        content: assistant.content,
        model: parsed.model ?? result.model,
        latencyMs,
      },
      steps: parsed.steps,
      charts: parsed.charts,
      documents: parsed.documents,
      suggestedQueries: parsed.suggestedQueries,
      pendingApprovals: parsed.pendingApprovals,
    });
  } catch (err: any) {
    console.error('chat route failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Agent call failed' },
      { status: 500 },
    );
  }
}

/** Load an existing conversation with its artifacts (for resume). */
export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get('threadId');
  if (!threadId) {
    const threads = await prisma.thread.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 30,
      include: { _count: { select: { messages: true } } },
    });
    return NextResponse.json({ threads });
  }

  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      approvals: { orderBy: { requestedAt: 'desc' } },
    },
  });

  return NextResponse.json({ thread });
}
