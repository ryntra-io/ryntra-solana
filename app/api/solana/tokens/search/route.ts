import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { searchCatalogShared } from "@/lib/spot/catalog-search.server";
import { retryAfterHeader } from "@/lib/spot/shared-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Find an asset by ticker, name or mint address.
 *
 * The Trade card used to offer six mints, which is a fine starting list and a
 * dead end the moment someone wants the seventh. This route is the way out of
 * it: Jupiter's own catalogue, read server-side so the endpoint stays an
 * operator's choice rather than a page's, and returned with the two
 * structural facts a swap cannot proceed without — decimals and the owning
 * token program.
 *
 * It reads only. Every mint a person picks here is still re-read from the
 * chain, passported and judged by the review policy before any quote, and
 * again before any transaction is built. Nothing on this list is a
 * recommendation; `isVerified` and `isSuspicious` are Jupiter's claims and
 * travel labelled as such.
 *
 * CITY-208: the read goes through the shared read layer — the same query at
 * once is one call, an answer is kept half a minute here and a minute for
 * every instance, and after Jupiter's `429` the last good answer is served
 * with `stale: true` and its time. `GET ?query=&limit=` answers the same and
 * is kept at the edge, so the same words typed anywhere are one read a region.
 */

const RequestSchema = z
  .object({
    query: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(50).default(24),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision, retryAfterMs?: number | null) {
  return Response.json({ error: { code, message } }, { status, headers: { ...responseHeaders(rate), ...retryAfterHeader(retryAfterMs) } });
}

async function answer(query: string, limit: number, rate: RateLimitDecision, edge: boolean) {
  const result = await searchCatalogShared(query, limit);
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "MALFORMED" ? 502 : 503;
    return failure(status, `TOKENS_${result.code}`, result.reason, rate, result.retryAfterMs);
  }
  /* A held answer is kept at the edge only briefly: the fresh one reaches people as soon as there is one. */
  const cache = edge ? (result.stale ? publicCacheHeaders(3, 15) : publicCacheHeaders(30, 120)) : privateNoStoreHeaders();
  return Response.json(
    { tokens: result.rows, observedAt: result.observedAt, stale: result.stale, source: result.source },
    { headers: { ...cache, ...rateLimitHeaders(rate) } },
  );
}

/** The same search by its address, so the edge can keep it: `?query=` (1–64 characters) and `limit` (1–50, default 24). */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const parsed = RequestSchema.safeParse({ query: params.get("query") ?? "", ...(params.has("limit") ? { limit: Number(params.get("limit")) } : {}) });
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The token search request did not match its schema.", rate);
  return answer(parsed.data.query, parsed.data.limit, rate, true);
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The token search request did not match its schema.", rate);
  }

  return answer(parsed.data.query, parsed.data.limit, rate, false);
}
