import { NextRequest, NextResponse } from "next/server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { replayBenefitJobs } from "@/lib/rewards/benefit-replay.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Retries bookkeeping from confirmed settlements; this route has no payout path. */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const result = await replayBenefitJobs(getGuardRuntime().store, { limit: 8, budgetMs: 40_000 });
    return NextResponse.json({ ok: true, ...result }, { headers: privateNoStoreHeaders() });
  } catch { return NextResponse.json({ ok: false, error: "BOOKKEEPING_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() }); }
}
