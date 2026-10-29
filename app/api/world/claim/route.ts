import { worldApi } from "@/lib/world/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return worldApi().claim(req);
}
