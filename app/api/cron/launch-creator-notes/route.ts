import { NextRequest, NextResponse } from "next/server";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { runCreatorNotes } from "@/lib/launch/creator-notes.server";
import { runQuoteWatch } from "@/lib/launch/quote-watch.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";
import { decideBearerAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The pass stops starting a launch after this long: each read (its fees, its holders) is seen through inside the route's 60 s. */
const BUDGET_MS = 35_000;
/** The pair currencies' watch goes first and briefly: one read of every pair's mint, then the notes of a change. */
const QUOTE_BUDGET_MS = 8_000;

/**
 * The creators' notes, every ten minutes (vercel.json, SOL-L2): a few launches a pass read from the chain — the token
 * launched, passed a number of holders, moved to the DEX, has creator fees to take — each written once into the
 * wallet's inbox and, where it connected Telegram, sent there by the monitoring pass. Before them, the pair currencies'
 * watch (SOL-L12): every pair's mint read once and held against its first profile — a change marks its markets, writes
 * their creators a note and pauses new launches on it. Reads only; signs nothing. Called by Vercel's cron with
 * `CRON_SECRET`; anything else is refused.
 */
export async function GET(req: NextRequest) {
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  const deps = launchMarketDeps();
  if (!deps) return NextResponse.json({ ok: true, state: "NOT_SERVED" }, { headers: privateNoStoreHeaders() });
  try {
    /* A watch that fails leaves the notes to run: the pairs are read again in ten minutes. */
    const quotes = await runQuoteWatch(deps, { budgetMs: QUOTE_BUDGET_MS }).catch(() => null);
    const steps = await runCreatorNotes(deps, { budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, state: "RAN", quotes, steps }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "NOTES_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
