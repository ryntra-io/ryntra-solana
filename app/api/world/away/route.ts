import { worldApi } from "@/lib/world/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return worldApi().away(req);
}
