import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { proCollectMinute } from "@/lib/pro-limits/service.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The agent collects what filled of the ladders people let it collect: each build opens nothing, is judged
 * byte by byte, and only then signed by the agent's key; the program pays what is collected into the holder's own
 * accounts. It runs only where `RYNTRA_PRO_LIMITS` names an open network and the agent's key is there; anywhere else
 * it sits still and says why. Called with `CRON_SECRET`; it has no schedule of its own until ladders open (D-M4).
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await proCollectMinute();
    if (!answer.ok) return NextResponse.json({ ok: true, ran: false, why: answer.code }, { headers: privateNoStoreHeaders() });
    return NextResponse.json({ ok: true, ran: true, lines: answer.value.map((line) => ({ order: line.order, did: line.did, why: line.why })) }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "LADDERS_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
