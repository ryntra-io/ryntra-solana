import { crewApi } from "@/lib/world/server";
import { crewsClosed } from "../../closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return crewsClosed() ?? crewApi().invite(req, (await params).code);
}
