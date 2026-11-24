import { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { readEarnPeriods } from "@/lib/earn-pools/service.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `GET /api/earn/pools/periods` — the terminal's read of the pools' table by window: each pool of
 * `/api/v1/earn/pools` with its volume and fees over the last 30 minutes, hour, two hours and day, as Meteora's Data API
 * states them. The same catalogue read as the pools themselves (kept two minutes for every visitor), so it asks Meteora
 * nothing of its own. Public and read-only; kept a minute at the edge. Not a part of the public API v1.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const answer = await readEarnPeriods().catch(() => null);
  if (!answer || !answer.pools.length) return apiFailure("UNAVAILABLE", "Meteora did not answer for the pools. Try again.", { headers: rateLimitHeaders(rate) });
  return NextResponse.json(answer, { headers: { ...apiHeaders(), ...publicCacheHeaders(60, 120), ...rateLimitHeaders(rate) } });
}
