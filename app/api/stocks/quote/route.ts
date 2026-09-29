import { z } from "zod";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { quoteStock, STOCK_QUOTE_MAX_USD } from "@/lib/stocks/quote.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The size-aware quote (canon v4.0 §7.5): `usd` of a stock token on a side,
 * through the same Jupiter order path Spot executes on, quote-only, with the
 * token leg in underlying units and the executable per-share price against
 * the issuer's reference. Never cached at the edge — a quote is a fact about
 * a moment — and never a transaction: nothing here can be signed.
 */

const QuerySchema = z
  .object({
    ticker: z.string().regex(/^[A-Za-z0-9._-]{1,44}$/),
    side: z.enum(["BUY", "SELL"]).default("BUY"),
    usd: z.coerce.number().min(1).max(STOCK_QUOTE_MAX_USD),
  })
  .strict();

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The quote request did not match its schema.", rate);
  const read = await quoteStock(parsed.data);
  if (!read.ok) {
    /* LIFECYCLE: the issuer does not offer this token for purchase now — a conflict with the request, never a server fault. */
    const status = read.code === "UNKNOWN_ASSET" ? 404 : read.code === "AMOUNT" || read.code === "UNITS" ? 400 : read.code === "NO_ROUTE" || read.code === "LIFECYCLE" ? 409 : 503;
    return failure(status, read.code, read.reason, rate);
  }
  return Response.json(read.quote, { headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}
