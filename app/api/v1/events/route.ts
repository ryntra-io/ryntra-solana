import { after } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { BASE58, type MarketEventsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { coverageOf, EVENT_KINDS, eventKindsOf, eventViewOf, EVENTS_MAX, orderEvents } from "@/lib/events/market-events";
import { readMarketEvents } from "@/lib/events/market-events.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readMarketsBehind } from "@/lib/launch/markets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIMIT_DEFAULT = 50;

/**
 * `GET /api/v1/events` (contract 1.68.0, DSC-1) — «Події ринку»: one feed of what happened on Solana's markets, the
 * newest first, each event with its type, when it happened and when Ryntra saw it, its sources, its transaction or
 * account on the explorer, its finality and the token's Pulse risk flags; a suspicious token's event never above the
 * first five clean ones. `kinds=` (comma-separated; none known is VALIDATION_ERROR) and `mint=` narrow it — a launch's
 * own log is read for its mint — and `limit=` (1–200, 50 by default) cuts it; `total` counts what the filter found.
 * Public: no wallet. No advice and no trade — an event opens the token's own page, where the quote and the Review are.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint");
  if (mint !== null && !BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const limitText = params.get("limit");
  const limit = limitText === null ? LIMIT_DEFAULT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > EVENTS_MAX) return apiFailure("VALIDATION_ERROR", `limit: a whole number from 1 to ${EVENTS_MAX}`);
  const asked = eventKindsOf(params.get("kinds"));
  if (asked === null) return apiFailure("VALIDATION_ERROR", `kinds: none of ${EVENT_KINDS.join(", ")}`);
  const kinds = new Set(asked);

  const read = await readMarketEvents({ mint });
  /* Ryntra's markets the answer could not read in time are read behind it, so the next answer has them. */
  after(() => readMarketsBehind());
  if (!read.ok) return apiFailure("UNAVAILABLE", read.reason, { headers: rateLimitHeaders(rate) });
  /* Ordered again after the filter: a filter never lifts a suspicious token's event to the top. */
  const picked = orderEvents(read.events.filter((event) => kinds.has(event.kind) && (mint === null || event.token.mint === mint)));
  const body = {
    events: picked.slice(0, limit).map(eventViewOf),
    total: picked.length,
    observedAt: read.observedAt,
    stale: read.stale,
    partial: read.partial,
    sources: [...read.sources],
    logs: read.logs ? { ...read.logs } : null,
    coverage: coverageOf(),
  } satisfies MarketEventsResponse;
  return apiJson(body, 200, { ...publicCacheHeaders(10, 30), ...rateLimitHeaders(rate) });
}
