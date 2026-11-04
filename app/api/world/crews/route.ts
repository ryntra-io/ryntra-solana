import { crewApi } from "@/lib/world/server";
import { crewsClosed } from "../crew/closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return crewsClosed() ?? crewApi().streets(req);
}
