import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import type { PhoenixRead } from "@/lib/phoenix/read.server";

/**
 * The answers of «Ф'ючерси»'s reads (B7): a public read cached at the edge for its own few seconds, so everyone looking
 * at the same market costs Phoenix one read; a failure says whose it is — Phoenix's limit (429) or Phoenix being down
 * (503) — and is never cached.
 */
export function failure(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export function answer<T>(read: PhoenixRead<T>, rate: RateLimitDecision, cache: Readonly<{ ttl: number; stale: number }> | "private"): Response {
  if (!read.ok) {
    if (read.code === "RATE_LIMITED") return failure(429, "PHOENIX_RATE_LIMITED", "Phoenix asked to slow down; the last read stays on screen.", rate);
    if (read.code === "NOT_FOUND") return failure(404, "PHOENIX_NOT_FOUND", "Phoenix has no such market.", rate);
    return failure(503, "PHOENIX_UNAVAILABLE", "Phoenix did not answer; the last read stays on screen.", rate);
  }
  const headers =
    cache === "private"
      ? { "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store" }
      : publicCacheHeaders(cache.ttl, cache.stale);
  return Response.json(read.value, { headers: { ...headers, ...rateLimitHeaders(rate) } });
}
