import { after } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { TAPE_PARTIAL_TTL_MS, TAPE_TTL_MS } from "@/lib/spot/tape";
import { readTape, tapeRefresh } from "@/lib/spot/tape.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The landing's market tape (SOL-T4): eight Solana markets with their price, their day's change and a day of hourly
 * closes for the core's sparkline — one read for every visitor, kept by the server and at the edge for two minutes
 * (twenty seconds while a line is still to come).
 * Read-only and wallet-free. A failed read answers 503 and the tape keeps its height with nothing in it.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) {
    return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
  }
  const read = await readTape();
  /* A refresh that outran this answer finishes after it, rather than freezing with the function. */
  const refresh = tapeRefresh();
  if (refresh) after(() => refresh.then(() => undefined));
  if (!read) {
    return Response.json({ error: { code: "TAPE_UNAVAILABLE", message: "The market tape's sources did not answer." } }, { status: 503, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
  }
  /* A read with a line still to come is kept briefly: the next one fills it in. */
  const ttl = Math.floor((read.complete ? TAPE_TTL_MS : TAPE_PARTIAL_TTL_MS) / 1000);
  return Response.json(read, { headers: read.stale ? { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } : { ...publicCacheHeaders(ttl, ttl * 5), ...rateLimitHeaders(rate) } });
}
