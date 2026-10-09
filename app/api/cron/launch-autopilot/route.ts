import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { runExecutorMinute } from "@/lib/launch/executor-cron.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ryntra Launch's executor, every minute (vercel.json): one pass over the network's launches — a full curve graduated,
 * a failed graduation sent again, the Fee-Funded Liquidity Ladder kept where it stands and its stop is open, the
 * holders' collector, and what changed noted in each market's flight log. It signs mainnet with the executor's key —
 * only the key of the address the attribution registry publishes, only on the production deployment with a store every
 * instance shares — and only inside the policies of `lib/launch/autopilot.server.ts`; a market the operator stopped gets
 * nothing signed. Called by Vercel's cron with `CRON_SECRET`; anything else is refused.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await runExecutorMinute();
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "EXECUTOR_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
