import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readStockAsset } from "@/lib/stocks/asset.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * One representation in full: the screener row, the mint as the chain states
 * it (authorities, extensions, the Scaled UI Amount multiplier), the issuer's
 * attested reserves and the pool the token trades in. Addressed by the token's
 * symbol or its mint. Cached briefly; the executable quote is a separate read.
 */

const TICKER = /^[A-Za-z0-9._-]{1,44}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const ticker = new URL(request.url).searchParams.get("ticker") ?? "";
  if (!TICKER.test(ticker)) return failure(400, "VALIDATION_ERROR", "A stock is addressed by its token symbol or mint.", rate);
  const read = await readStockAsset(ticker);
  if (!read.ok) return failure(read.code === "UNKNOWN_ASSET" ? 404 : 503, read.code, read.reason, rate);
  return Response.json(read.asset, { headers: { ...publicCacheHeaders(20, 60), ...rateLimitHeaders(rate) } });
}
