import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  approveAction,
  rejectAction,
  fetchPendingApprovals,
} from '@/lib/snowflake';
import { ApprovalStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Pending approvals. Snowflake is authoritative; Postgres is the mirror. */
export async function GET() {
  const rows = (await fetchPendingApprovals()) as any[];

  // Keep the mirror in step with Snowflake so the UI can read locally.
  for (const r of rows) {
    const snapshot =
      typeof r.METRIC_SNAPSHOT === 'string'
        ? JSON.parse(r.METRIC_SNAPSHOT)
        : r.METRIC_SNAPSHOT;
    const payload =
      typeof r.ACTION_PAYLOAD === 'string'
        ? JSON.parse(r.ACTION_PAYLOAD)
        : r.ACTION_PAYLOAD;

    await prisma.approval.upsert({
      where: { approvalId: r.APPROVAL_ID },
      update: { status: ApprovalStatus.PENDING },
      create: {
        approvalId: r.APPROVAL_ID,
        agentName: r.AGENT_NAME,
        toolName: r.TOOL_NAME,
        estimatedValueUsd: r.ESTIMATED_VALUE_USD ?? null,
        payload: payload ?? null,
        metricSnapshot: snapshot ?? null,
      },
    });
  }

  const approvals = await prisma.approval.findMany({
    where: { status: ApprovalStatus.PENDING },
    orderBy: { requestedAt: 'desc' },
  });

  return NextResponse.json({ approvals });
}

/**
 * Approve or reject a queued high-value action.
 *
 * The decision is executed by the Snowflake procedure, not here, so the
 * audit trail and the autonomy policy stay server side.
 */
export async function POST(req: NextRequest) {
  try {
    const { approvalId, decision, note } = await req.json();

    if (!approvalId || !['APPROVE', 'REJECT'].includes(decision)) {
      return NextResponse.json(
        { error: 'approvalId and decision (APPROVE|REJECT) are required' },
        { status: 400 },
      );
    }

    const reason = note ?? `${decision} via BlueberryChain OS chat`;
    const result =
      decision === 'APPROVE'
        ? await approveAction(approvalId, reason)
        : await rejectAction(approvalId, reason);

    await prisma.approval.updateMany({
      where: { approvalId },
      data: {
        status:
          decision === 'APPROVE'
            ? ApprovalStatus.EXECUTED
            : ApprovalStatus.REJECTED,
        decisionNote: reason,
        decidedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error('approval route failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Approval failed' },
      { status: 500 },
    );
  }
}
