import { after } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readMarketsBehind } from "@/lib/launch/markets.server";
import { isPulseFeed, pulseModeOf, pulseWindowOf, watchlistMintsOf } from "@/lib/spot/pulse";
import { withoutOffensiveNames } from "@/lib/spot/offensive-names";
import { readPulse } from "@/lib/spot/pulse.server";
import { retryAfterHeader } from "@/lib/spot/shared-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Home's Pulse: one feed at a time —
 * `feed=new|soon|dex|trending|movers`, `window=m5|h1|h6|h24` where the feed
 * has windows — each row with its figures, its curve where it is on one, the
 * facts that count against it and whether it was launched on Ryntra. Public:
 * no wallet. The person's filters are applied where they are set, on the
 * page, over the rows this answers.
 *
 * Market Radar (SOL-R1, «Ринки» → «Меми») asks the same feeds with
 * `mode=meme` — only the tokens born on Meteora DBC, pump.fun and Raydium
 * LaunchLab — and two of its own: `feed=growing` and `feed=watchlist` with
 * `mints=` (the person's watched mints, at most a hundred, in their order).
 */

const CACHE: Readonly<Record<string, readonly [number, number]>> = {
  new: [10, 30],
  growing: [20, 60],
  soon: [15, 45],
  dex: [30, 90],
  trending: [30, 90],
  movers: [30, 90],
  watchlist: [15, 45],
};

function failure(status: number, code: string, message: string, rate: RateLimitDecision, retryAfterMs?: number | null) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), ...retryAfterHeader(retryAfterMs), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const feed = params.get("feed") ?? "";
  if (!isPulseFeed(feed)) return failure(400, "VALIDATION_ERROR", "feed is one of new, growing, soon, dex, trending, movers, watchlist.", rate);
  const read = await readPulse(feed, pulseWindowOf(feed, params.get("window")), { mode: pulseModeOf(params.get("mode")), mints: feed === "watchlist" ? watchlistMintsOf(params.get("mints")) : [] });
  /* Ryntra's markets the answer could not read in time are read behind it, so the next answer has them. */
  after(() => readMarketsBehind());
  if (!read.ok) return failure(read.code === "RATE_LIMITED" ? 429 : 503, `PULSE_${read.code}`, read.reason, rate, read.retryAfterMs);
  const { ok: _ok, ...answer } = read;
  /* A token named with a hate word is not offered (B2b): anyone can mint any name, and Pulse is open on Home. */
  const body = { ...answer, rows: withoutOffensiveNames(answer.rows), ...(answer.down ? { down: withoutOffensiveNames(answer.down) } : {}) };
  const [ttl, stale] = CACHE[feed] as readonly [number, number];
  return Response.json(body, { headers: { ...publicCacheHeaders(ttl, stale), ...rateLimitHeaders(rate) } });
}
