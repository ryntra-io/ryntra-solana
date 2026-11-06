import { NextRequest, NextResponse } from "next/server";

import { runDemandWeek } from "@/lib/growth/demand-week-telegram.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The owner's week of demand (CITY-197), every Monday: the week that has just closed, to the owner's Telegram. Internal
 * — the cron's bearer only. Shut unless `RYNTRA_DEMAND_WEEK=on`. Reads and sends one message; it moves nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401, headers: privateNoStoreHeaders() });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await runDemandWeek(process.env, getGuardRuntime());
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch (error) {
    void reportError("cron:demand-week", error, {});
    return NextResponse.json({ ok: false }, { status: 500, headers: privateNoStoreHeaders() });
  }
}
