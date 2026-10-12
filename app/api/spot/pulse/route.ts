import { after } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readMarketsBehind } from "@/lib/launch/markets.server";
import { isPulseFeed, pulseWindowOf } from "@/lib/spot/pulse";
import { readPulse } from "@/lib/spot/pulse.server";

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
 */

const CACHE: Readonly<Record<string, readonly [number, number]>> = {
  new: [10, 30],
  soon: [15, 45],
  dex: [30, 90],
  trending: [30, 90],
  movers: [30, 90],
};

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const feed = params.get("feed") ?? "";
  if (!isPulseFeed(feed)) return failure(400, "VALIDATION_ERROR", "feed is one of new, soon, dex, trending, movers.", rate);
  const read = await readPulse(feed, pulseWindowOf(feed, params.get("window")));
  /* Ryntra's markets the answer could not read in time are read behind it, so the next answer has them. */
  after(() => readMarketsBehind());
  if (!read.ok) return failure(read.code === "RATE_LIMITED" ? 429 : 503, `PULSE_${read.code}`, read.reason, rate);
  const { ok: _ok, ...body } = read;
  const [ttl, stale] = CACHE[feed] as readonly [number, number];
  return Response.json(body, { headers: { ...publicCacheHeaders(ttl, stale), ...rateLimitHeaders(rate) } });
}
