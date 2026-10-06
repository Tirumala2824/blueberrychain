import { appContext } from "@/server/context";
import * as h from "@/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) => h.getSession(appContext(), req);
export const POST = (req: Request) => h.postSession(appContext(), req);
export const DELETE = (req: Request) => h.deleteSession(appContext(), req);
