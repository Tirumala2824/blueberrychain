import { appContext } from "@/server/context";
import * as h from "@/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => h.postConsole(appContext(), req);
