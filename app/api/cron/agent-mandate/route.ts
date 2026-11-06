import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { agentMinute } from "@/lib/mandate/agent-service.server";
import { pilotMinute } from "@/lib/pilot/service.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CITY-175 — the agent at work (vercel.json): one pass over its book on devnet — for each mandate a person signed, a buy
 * when her strategy says one is due, inside the limits her policy holds on chain. It runs only where the mandate's switch
 * says devnet, with the agent's own devnet key and a store that survives a cold start; anywhere else it sits still and
 * says why. Called by Vercel's cron with `CRON_SECRET`; anything else is refused.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    /* CITY-204: the money autopilot looks after its plans first, so a hold it sets is in the book before the agent trades. */
    const pilot = await pilotMinute(process.env).catch(() => ({ ran: false as const, why: "unavailable" }));
    const answer = await agentMinute(process.env);
    return NextResponse.json({ ok: true, ...answer, pilot }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "AGENT_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
