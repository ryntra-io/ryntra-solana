import { NextResponse } from "next/server";

import { readPublicStats } from "@/lib/attribution/stats.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The public statistics as JSON — the same model `/stats` draws, so a script,
 * a dashboard or the native client reads the figures the page shows and not a
 * second set. Public and unauthenticated: everything in it is a chain fact or
 * a labelled record, and the wallet on every row is masked.
 *
 * The ledger block is read live; a confirmed operation is here within seconds
 * of its row. The edge may keep one answer for five seconds and serve it ten
 * more while it fetches the next, so a burst of readers costs one read and
 * nobody waits — the header says exactly that. The chain block inside it is
 * the shared read, ten minutes old at most, and says so with `updatedAt`.
 */
export async function GET() {
  const stats = await readPublicStats();
  return NextResponse.json(
    { stats },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=10" } },
  );
}
