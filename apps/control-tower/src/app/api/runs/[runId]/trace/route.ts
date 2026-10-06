import { appContext } from "@/server/context";
import * as h from "@/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  return h.getTrace(appContext(), req, (await params).runId);
}
