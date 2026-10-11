import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readTokenAbout } from "@/lib/spot/token-about.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * «Що це за монета»: the description the token's creator wrote in its
 * metadata, read from the chain and the metadata's own address
 * (`lib/spot/token-about.server.ts`). The answer says which of four it is —
 * described, silent, no metadata, or not read now — so the page never draws a
 * silence for a read that failed. Cached at the edge by the mint: a creator
 * rarely rewrites what a token is.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint") ?? "";
  if (!BASE58.test(mint)) return failure(400, "VALIDATION_ERROR", "A token is addressed by its mint.", rate);
  /* The name and the symbol the page already shows: a description that only repeats them is no description. */
  const names = [params.get("name"), params.get("symbol")].filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 128);
  const about = await readTokenAbout(mint, names);
  const cache = about.state === "unread" ? publicCacheHeaders(60, 120) : publicCacheHeaders(3_600, 21_600);
  return Response.json({ about, observedAt: new Date().toISOString() }, { headers: { ...cache, ...rateLimitHeaders(rate) } });
}
