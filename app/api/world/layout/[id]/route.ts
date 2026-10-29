import { freeBuildOpen } from "@/lib/world/layout";
import { layoutApi } from "@/lib/world/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Until the owner opens free building (`NEXT_PUBLIC_RYNTRA_CITY_FREE_BUILD=open`), nothing is read or kept here. */
const closed = () =>
  Response.json({ error: { code: "NOT_FOUND", message: "No such quarter." } }, { status: 404, headers: { "cache-control": "private, no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!freeBuildOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_FREE_BUILD)) return closed();
  return layoutApi().ofQuarter(req, (await params).id);
}
