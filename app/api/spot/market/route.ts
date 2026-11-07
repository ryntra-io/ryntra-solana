import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readSpotMarket } from "@/lib/spot/markets.server";
import { retryAfterHeader } from "@/lib/spot/shared-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * One market, whole: the header's live price and 24h change, the stats strip,
 * the audit facts behind the meme risk line, the issuer and links behind
 * Asset details. Polled by the page every fifteen seconds, which is as fresh
 * as the provider's own cache lets a price be.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision, retryAfterMs?: number | null) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), ...retryAfterHeader(retryAfterMs), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const mint = new URL(request.url).searchParams.get("mint") ?? "";
  if (!BASE58.test(mint)) return failure(400, "VALIDATION_ERROR", "A market is addressed by its mint.", rate);
  const read = await readSpotMarket(mint);
  if (!read.ok) return failure(read.code === "RATE_LIMITED" ? 429 : 503, `MARKET_${read.code}`, read.reason, rate, read.retryAfterMs);
  if (read.market === null) {
    return Response.json({ market: null, observedAt: read.observedAt, stale: false }, { headers: { ...publicCacheHeaders(15, 60), ...rateLimitHeaders(rate) } });
  }
  return Response.json(
    { market: read.market, observedAt: read.observedAt, stale: read.stale },
    /* A held copy (CITY-208) is kept at the edge only briefly: the next visitor gets the fresh read as soon as there is one. */
    { headers: { ...(read.stale ? publicCacheHeaders(3, 15) : publicCacheHeaders(10, 40)), ...rateLimitHeaders(rate) } },
  );
}
