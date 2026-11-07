import { z } from "zod";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { isSpotView } from "@/lib/spot/markets";
import { listSpotMarkets, readSpotMarketsByMint, searchSpotMarkets, spotListEdgeSeconds } from "@/lib/spot/markets.server";
import { toListRow } from "@/lib/spot/markets";
import { retryAfterHeader } from "@/lib/spot/shared-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A list refresh that outlives its answer runs inside this invocation (`after`): the universe's slowest honest read is about 44 s. */
export const maxDuration = 60;

/**
 * The Spot market list — one view at a time, or a search, or a list of mints.
 *
 * `?view=all|crypto|meme|stock` returns the ranked list for that category;
 * `?q=` searches Jupiter's catalogue by symbol, name or mint; `?mints=a,b,c`
 * resolves a watchlist or a wallet's holdings to market rows in the order
 * given. Read-only and wallet-free, cached briefly at the edge because the
 * same list is what every visitor sees.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const QuerySchema = z
  .object({
    view: z.string().optional(),
    q: z.string().max(64).optional(),
    mints: z.string().max(4_600).optional(),
    limit: z.coerce.number().int().min(1).max(300).default(150),
  })
  .strict();

function headers(rate: RateLimitDecision, ttl: number) {
  return { ...publicCacheHeaders(ttl, ttl * 4), ...rateLimitHeaders(rate) };
}

function listHeaders(rate: RateLimitDecision, oldestReadAt: string) {
  const edge = spotListEdgeSeconds(oldestReadAt, Date.now());
  return edge ? { ...publicCacheHeaders(edge.ttl, edge.revalidate), ...rateLimitHeaders(rate) } : { ...rateLimitHeaders(rate), ...privateNoStoreHeaders() };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision, retryAfterMs?: number | null) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), ...retryAfterHeader(retryAfterMs), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The market list request did not match its schema.", rate);
  const { view, q, mints, limit } = parsed.data;

  if (mints !== undefined) {
    const list = mints.split(",").map((mint) => mint.trim()).filter((mint) => BASE58.test(mint));
    if (list.length === 0) return Response.json({ rows: [], observedAt: new Date().toISOString(), stale: false }, { headers: headers(rate, 15) });
    /* When Jupiter refuses, the last good read of this set (CITY-208), stated stale with the time it was read; `missing` is that read's. */
    const read = await readSpotMarketsByMint(list, 8_000, { held: true });
    if (!read.ok) return failure(read.code === "RATE_LIMITED" ? 429 : 503, `MARKETS_${read.code}`, read.reason, rate, read.retryAfterMs);
    const rows = list.map((mint) => read.byMint.get(mint)).filter((market) => market !== undefined).map(toListRow);
    return Response.json(
      { rows, missing: list.filter((mint) => !read.byMint.has(mint)), observedAt: read.observedAt, stale: read.stale, ...(read.stale ? { lastGoodAt: read.observedAt } : {}) },
      { headers: read.stale ? { ...publicCacheHeaders(3, 15), ...rateLimitHeaders(rate) } : headers(rate, 15) },
    );
  }

  if (q !== undefined && q.trim().length > 0) {
    const read = await searchSpotMarkets(q, Math.min(limit, 40));
    if (!read.ok) return failure(read.code === "RATE_LIMITED" ? 429 : 503, `MARKETS_${read.code}`, read.reason, rate, read.retryAfterMs);
    return Response.json(
      { rows: read.rows, observedAt: read.observedAt, stale: read.stale, ...(read.lastGoodAt ? { lastGoodAt: read.lastGoodAt } : {}), source: read.source },
      { headers: read.stale ? { ...publicCacheHeaders(3, 15), ...rateLimitHeaders(rate) } : headers(rate, 10) },
    );
  }

  const resolvedView = view === undefined ? "all" : view;
  if (!isSpotView(resolvedView) || resolvedView === "watchlist") {
    return failure(400, "VALIDATION_ERROR", "Unknown market view.", rate);
  }
  const read = await listSpotMarkets(resolvedView, limit);
  if (!read.ok) return failure(read.code === "RATE_LIMITED" ? 429 : 503, `MARKETS_${read.code}`, read.reason, rate, read.retryAfterMs);
  /* A partial or stale read is not cached at the edge: the next visitor must
     not inherit a category list the universe never filled, nor a «stale» the
     server has since mended. */
  return Response.json(
    { rows: read.rows, observedAt: read.observedAt, stale: read.stale, ...(read.lastGoodAt ? { lastGoodAt: read.lastGoodAt } : {}), partial: read.partial, source: read.source },
    { headers: read.partial || read.stale ? { ...rateLimitHeaders(rate), ...privateNoStoreHeaders() } : listHeaders(rate, read.oldestReadAt) },
  );
}
