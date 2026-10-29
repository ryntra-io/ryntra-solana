import { momentsApi } from "@/city/lib/moments/drafts/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return momentsApi().getClip(req, (await params).id);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return momentsApi().putClip(req, (await params).id);
}
