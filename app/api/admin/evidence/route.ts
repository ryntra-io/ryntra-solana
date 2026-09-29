import { NextResponse } from "next/server";

import { readEvidenceUsage } from "@/lib/evidence/service.server";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The evidence layer's usage for the Owner, per provider
 * (`RYN-NANSEN-EVIDENCE-001`, `RYN-DDXYZ-RISK-001`): the two ledgers (today,
 * the packet or the month), the ceilings in force, the provider's own
 * last-reported balance — from its headers, or from its usage endpoint read
 * for reconciliation and cached ten minutes (`?reconcile=1` reads it again)
 * — and the rights the reads ran under; the figures the providers' dashboards
 * reconcile with. Admin session only; never a key.
 */
export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const reconcile = new URL(request.url).searchParams.get("reconcile") === "1";
    const usage = await readEvidenceUsage({ reconcile });
    return NextResponse.json({ generatedAt: new Date().toISOString(), usage }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "unavailable", message: error instanceof Error ? error.message : String(error) }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
