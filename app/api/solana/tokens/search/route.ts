import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { searchTokenCatalog } from "@/lib/solana/catalog";

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

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
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

  const result = await searchTokenCatalog(parsed.data.query, parsed.data.limit);
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "MALFORMED" ? 502 : 503;
    return failure(status, `TOKENS_${result.code}`, result.reason, rate);
  }
  return Response.json(
    { tokens: result.rows, observedAt: result.observedAt, source: result.source },
    { headers: responseHeaders(rate) },
  );
}
