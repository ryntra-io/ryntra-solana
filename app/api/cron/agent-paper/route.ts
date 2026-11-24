import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { DAY_MS } from "@/lib/mandate/paper/model";
import { runPaperPass } from "@/lib/mandate/paper/service.server";
import { PaperStoreUnavailable } from "@/lib/mandate/paper/store";
import { paperDeps, paperOpen } from "@/lib/mandate/paper/wire.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The weeks that ended are kept this long after their last change, then gone (once a day, in the first pass after 03:00 UTC). */
const KEEP_DAYS = 90;
const PURGE_AT_MS = 3 * 3_600_000;
const PASS_EVERY_MS = 5 * 60_000;

/**
 * The agent's week on paper at work (vercel.json, every 5 minutes, as the agent's own pass): for each paper
 * agent at work, the agent's own rules on the live route's prices — a paper buy when its plan says one is due, its own
 * pause, its exit, its week's end. Paper only: quotes, no wallet, no signature, nothing placed. It runs only where the
 * deployment says `RYNTRA_AGENT_PAPER=open` and the store is there; anywhere else it sits still and says why. Called by
 * Vercel's cron with `CRON_SECRET`; anything else is refused.
 *
 * Every quote is asked within paper's own share of Jupiter's window (`lib/mandate/paper/quota.ts`), never from the half
 * that belongs to agents with money: when the share runs out the pass stops (`counts.held`) and the agents not reached
 * keep their place at the head of the next pass.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  if (!paperOpen()) return NextResponse.json({ ok: true, ran: false, why: "closed" }, { headers: privateNoStoreHeaders() });
  try {
    const deps = paperDeps();
    const lines = await runPaperPass(deps);
    const counts: Record<string, number> = {};
    for (const line of lines) counts[line.did] = (counts[line.did] ?? 0) + 1;
    const now = Date.now();
    const purged = now % DAY_MS >= PURGE_AT_MS && now % DAY_MS < PURGE_AT_MS + PASS_EVERY_MS ? await deps.store.purge(KEEP_DAYS).catch(() => null) : undefined;
    return NextResponse.json({ ok: true, ran: true, agents: lines.filter((line) => line.did !== "held").length, counts, ...(purged === undefined ? {} : { purged }) }, { headers: privateNoStoreHeaders() });
  } catch (error) {
    if (error instanceof PaperStoreUnavailable) return NextResponse.json({ ok: true, ran: false, why: "no-store" }, { headers: privateNoStoreHeaders() });
    return NextResponse.json({ ok: false, error: "PAPER_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
