import { momentsApi } from "@/city/lib/moments/drafts/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return momentsApi().getSwitch(req);
}

export async function POST(req: Request) {
  return momentsApi().setSwitch(req);
}
