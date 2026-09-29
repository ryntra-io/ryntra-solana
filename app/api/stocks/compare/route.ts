import { z } from "zod";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { compareRepresentations } from "@/lib/stocks/compare.server";
import { STOCK_QUOTE_MAX_USD } from "@/lib/stocks/quote.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The comparison of representations (canon v4.0 §7.7): the open stock token
 * and every other confirmed representation of the same underlying, each
 * quoted for the same `usd` on the same side through the one quote path Spot
 * executes on, read on one basis — the executable price per underlying share.
 * The lowest is named as the lowest quoted cost for this amount, never as the
 * best token. Never cached at the edge — a comparison is a fact about a
 * moment — and never a transaction. A Sell answers the open token alone.
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
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The comparison request did not match its schema.", rate);
  const read = await compareRepresentations(parsed.data);
  if (!read.ok) {
    const status = read.code === "UNKNOWN_ASSET" ? 404 : read.code === "AMOUNT" ? 400 : read.code === "LIFECYCLE" ? 409 : 503;
    return failure(status, read.code, read.reason, rate);
  }
  return Response.json(read.comparison, { headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}
