import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { matchRows, toSlimRow } from "@/app/app/stocks/stock-model";
import { readStockUniverse } from "@/lib/stocks/universe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The stock universe — every confirmed representation with its screener
 * figures: the token's own market, the issuer's reference and session, the
 * multiplier and the list-basis deviation. Read-only, wallet-free, cached
 * briefly at the edge because every visitor sees the same list. A screener
 * row's reference is a cached issuer figure with its fetch time, never an
 * executable price; the size-aware quote is `/api/stocks/quote`.
 *
 * `?shape=slim` answers the rows as the stock surface draws them — the
 * identity, the figures and the states, a fifth of the weight — for the
 * browser's search over every listed stock. `?shape=slim&q=nvidia` answers
 * only the rows that match by company, ticker or token, ranked the way the
 * browser ranks them (`matchRows`), so a phone on a metered connection asks
 * for the handful it needs instead of the whole list (the mobile line's
 * request 7); the browser's behaviour is unchanged.
 */

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const read = await readStockUniverse();
  if (!read.ok) return failure(503, read.code, read.reason, rate);
  const headers = { ...publicCacheHeaders(30, 120), ...rateLimitHeaders(rate) };
  const params = new URL(request.url).searchParams;
  if (params.get("shape") === "slim") {
    const nowMs = Date.now();
    /* `mints` narrows the slim rows to the ones asked for — the Portfolio's
       own holdings, a handful of rows instead of the whole market. A mint
       that is not a confirmed representation is simply absent. */
    const wanted = params.get("mints");
    const mints = wanted === null ? null : new Set(wanted.split(",").map((mint) => mint.trim()).filter((mint) => BASE58.test(mint)).slice(0, 200));
    const rows = mints === null ? read.universe.rows : read.universe.rows.filter((row) => mints.has(row.representation.mint));
    const slim = rows.map((row) => toSlimRow(row, nowMs));
    const query = params.get("q")?.trim() ?? "";
    if (query.length > 64) return failure(400, "VALIDATION_ERROR", "A search needs one to sixty-four characters.", rate);
    const limitParam = params.get("limit");
    const limit = limitParam === null ? null : Number(limitParam);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 400)) return failure(400, "VALIDATION_ERROR", "limit must be a whole number from 1 to 400.", rate);
    const matched = query.length > 0 ? matchRows(slim, query) : slim;
    return Response.json({ rows: limit === null ? matched : matched.slice(0, limit), fetchedAt: read.universe.fetchedAt, ...(query.length > 0 ? { query, total: matched.length } : {}) }, { headers });
  }
  return Response.json(read.universe, { headers });
}
