import { appContext } from "@/server/context";
import * as h from "@/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return h.getCase(appContext(), req, (await params).caseId);
}
