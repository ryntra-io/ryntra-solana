import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { scoutTick } from "@/lib/scout/tick.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Scout at work (vercel.json, every five minutes): one pass on paper — the market's new coins screened for free, the
 * chain read for the few that pass, a thesis from the model for the fewer, sized by the risk engine, opened and closed on
 * paper with live prices, every decision journalled. It runs only with `RYNTRA_SCOUT=paper` and a store every instance
 * shares; anywhere else it sits still and says why. Nothing here signs or sends. Called by Vercel's cron with
 * `CRON_SECRET`; anything else is refused.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await scoutTick(process.env);
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "SCOUT_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
