import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { autopayMinute } from "@/lib/autopay/service.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The executor's pass over the autopay queue (vercel.json, every minute): each autopay whose moment has come
 * gets its one step inside the person's policy on chain — the open window paid once, a payment on its way read back, the
 * end marked — within the pass's own budget (`lib/autopay/service.server.ts` `PASS`), well inside this route's 60 s. It
 * runs only where `RYNTRA_AUTOPAY` names the network and the executor's key is there; anywhere else it sits still and
 * says why. Called by Vercel's cron with `CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await autopayMinute(process.env);
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "AUTOPAY_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
