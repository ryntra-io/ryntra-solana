import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readStockLiquidity } from "@/lib/liquidity/service.server";
import { findStockRow } from "@/lib/stocks/universe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Where a tokenized stock actually trades (`RYN-STOCKS-LIQUIDITY-001`): every
 * Meteora DLMM and DAMM v2 pool that holds the token's verified mint, ranked,
 * with the venue's own TVL, 24 h volume, fees and fee rate, and the time each
 * source answered. Addressed by the token's symbol or mint; only a confirmed
 * stock representation is answered, so the route is not a general venue
 * proxy. Read-only; nothing here can create a pool or move liquidity.
 */

const TICKER = /^[A-Za-z0-9._-]{1,44}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const ticker = params.get("mint") ?? params.get("ticker") ?? "";
  if (!TICKER.test(ticker)) return failure(400, "VALIDATION_ERROR", "A stock is addressed by its token symbol or mint.", rate);
  const found = await findStockRow(ticker);
  if (!found.ok) return failure(503, found.code, found.reason, rate);
  if (!found.row) return failure(404, "UNKNOWN_ASSET", "That token is not a confirmed stock representation.", rate);
  const stockMints = new Set(found.universe.rows.map((row) => row.representation.mint));
  const liquidity = await readStockLiquidity(found.row.representation.mint, { stockMints });
  const headers = liquidity.state === "unavailable" ? { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } : { ...publicCacheHeaders(60, 300), ...rateLimitHeaders(rate) };
  return Response.json({ symbol: found.row.representation.symbol, ...liquidity }, { headers });
}
