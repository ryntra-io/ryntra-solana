import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { TIMEFRAME_TTL_MS, isSpotTimeframe } from "@/lib/spot/candles";
import { readSpotCandles } from "@/lib/spot/candles.server";
import { retryAfterHeader } from "@/lib/spot/shared-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Candles for one market and one timeframe, from the deepest pool the chart
 * source knows for the mint. Cached at the edge for the timeframe's own TTL so
 * a hundred people looking at SOL cost the source one read a minute, not a
 * hundred — and the pool and venue travel with the answer so the page can say
 * whose price this is.
 *
 * `?limit=120` answers the newest N bars instead of the source's full window
 * (300 bars; 366 on the daily timeframe, a year for «1Р» on a company page) —
 * the mobile line's request 8: a phone draws about 120 and halves the read. The
 * source is still asked for its full window, so the edge cache is one entry
 * per market and timeframe whatever the limit; only the answer is trimmed.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision, retryAfterMs?: number | null) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), ...retryAfterHeader(retryAfterMs), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const url = new URL(request.url);
  const mint = url.searchParams.get("mint") ?? "";
  const timeframe = url.searchParams.get("tf") ?? "1h";
  if (!BASE58.test(mint)) return failure(400, "VALIDATION_ERROR", "A chart is addressed by its mint.", rate);
  if (!isSpotTimeframe(timeframe)) return failure(400, "VALIDATION_ERROR", "Unknown timeframe.", rate);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? null : Number(limitParam);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 300)) return failure(400, "VALIDATION_ERROR", "limit must be a whole number from 1 to 300.", rate);
  const read = await readSpotCandles(mint, timeframe);
  if (!read.ok) {
    /* 404: this market has no chart, for a stated reason — the frame prints it.
       429/503: the source, not the market; the last read stays on screen. */
    const noChart = read.code === "NO_POOL" || read.code === "NO_MAJOR_QUOTE" || read.code === "THIN" || read.code === "QUIET" || read.code === "STALE" || read.code === "PRICE_MISMATCH";
    const status = noChart ? 404 : read.code === "RATE_LIMITED" ? 429 : 503;
    return failure(status, `CANDLES_${read.code}`, read.reason, rate, read.retryAfterMs);
  }
  const ttl = Math.max(5, Math.floor(TIMEFRAME_TTL_MS[timeframe] / 1000));
  return Response.json(
    { timeframe: read.timeframe, candles: limit === null ? read.candles : read.candles.slice(-limit), pool: read.pool, observedAt: read.observedAt, stale: read.stale, source: read.source, ...(limit === null ? {} : { limit, available: read.candles.length }) },
    /* A held copy (CITY-208: the source refused, the last good read is answered with its own time) is kept at the edge briefly. */
    { headers: { ...(read.stale ? publicCacheHeaders(5, 30) : publicCacheHeaders(ttl, ttl * 6)), ...rateLimitHeaders(rate) } },
  );
}
