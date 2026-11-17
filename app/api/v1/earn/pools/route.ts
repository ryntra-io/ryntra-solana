import { NextResponse } from "next/server";

import type { EarnPoolsResponse } from "@/lib/api/v1/contract";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { readEarnPools } from "@/lib/earn-pools/service.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `GET /api/v1/earn/pools` — the pools a person chooses from: Meteora DLMM and DAMM v2 pools from the
 * engine's catalogue, each with what it holds, a day's volume and fees, the fee a trade pays, DLMM's price step and its
 * age; and Jupiter Lend's rates beside them. Public and read-only; kept a minute at the edge, two in the process.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const answer = await readEarnPools().catch(() => null);
  if (!answer || (!answer.pools.length && !answer.sources.dlmm && !answer.sources.dammV2)) {
    return apiFailure("UNAVAILABLE", "Meteora did not answer for the pools. Try again.", { headers: rateLimitHeaders(rate) });
  }
  const body: EarnPoolsResponse = { ...answer, pools: [...answer.pools], lend: [...answer.lend] };
  return NextResponse.json(body, { headers: { ...apiHeaders(), ...publicCacheHeaders(60, 120), ...rateLimitHeaders(rate), Vary: "X-Ryntra-API" } });
}
