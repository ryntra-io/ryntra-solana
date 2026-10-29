import { momentsApi } from "@/city/lib/moments/drafts/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return momentsApi().approveAll(req);
}
