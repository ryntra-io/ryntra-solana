import { crewApi } from "@/lib/world/server";
import { crewsClosed } from "../closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return crewsClosed() ?? crewApi().join(req);
}
