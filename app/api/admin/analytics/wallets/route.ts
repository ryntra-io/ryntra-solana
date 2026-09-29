import { NextResponse } from "next/server";

import { readSeenWallets } from "@/lib/admin/seen-wallets.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Every wallet the product has seen, with whether the owner marked it as
 * theirs. Admin session only; marking and unmarking go through
 * `/api/admin/analytics/internal-wallets`, which this list reads back.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const read = await readSeenWallets(getGuardRuntime().store, { now: new Date().toISOString(), env: process.env });
  return NextResponse.json({ wallets: read.model, unavailable: read.unavailable }, { headers: { "Cache-Control": "private, no-store" } });
}
