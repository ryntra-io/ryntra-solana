import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { careMinute } from "@/lib/care/service.server";
import { proCareMinute } from "@/lib/earn-pro/care.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The agent looks after the piers people gave it (vercel.json, every ten minutes): for each care in its
 * book, the one step its rules say — open, claim, reinvest, keep the range around the price, leave at the person's
 * stop — inside the person's two policies on chain. It runs only where `RYNTRA_AGENT_CARE` names the network and the
 * agent's key is there; anywhere else it sits still and says why. Called by Vercel's cron with `CRON_SECRET`.
 *
 * The same pass then looks after the DLMM Pro positions people gave it through the program's own delegate
 * (`lib/earn-pro/care.server.ts`): the fees and the reward to the owner, everything out at the owner's stop. It runs
 * only where earning on DLMM Pro is served too; a failure of one pass never holds the other.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const [answer, pro] = await Promise.all([careMinute(process.env), proCareMinute(process.env).catch(() => ({ ran: false, reason: "failed" }) as const)]);
    return NextResponse.json({ ok: true, ...answer, pro }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "CARE_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
