import { crewApi } from "@/lib/world/server";
import { crewsClosed } from "./closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return crewsClosed() ?? crewApi().mine(req);
}

export async function POST(req: Request) {
  return crewsClosed() ?? crewApi().create(req);
}
