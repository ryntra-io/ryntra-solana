import { NextResponse } from "next/server";

import { readAllOperations } from "@/lib/attribution/stats.server";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Every operation the ledger holds, whole — the same projection the public
 * statistics draw, with nothing masked: the full wallet, the operation id,
 * the provider's request id, the exact fees and their split, the plan, the
 * verification state and its reason. Admin session only; never cached, so a
 * figure is the store at the moment of the request. One projection, two
 * disclosures — this route is the second, not a second truth.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const read = await readAllOperations();
  return NextResponse.json({ generatedAt: new Date().toISOString(), chainReadAt: read.chainReadAt, chainComplete: read.chainComplete, operations: read.operations }, { headers: { "Cache-Control": "private, no-store" } });
}
