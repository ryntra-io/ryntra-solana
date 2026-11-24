import { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readScout, readScoutChecks } from "@/lib/scout/read.server";
import { mintsOf } from "@/lib/scout/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * `GET /api/v1/scout` — the Scout on paper: the positions it would have opened and closed with live prices, its latest
 * decisions with their reasons and what its bars cut most today (`lib/scout/view.ts`). `?part=checks&mints=a,b,…` — the
 * Scout's latest check of each coin asked about (up to 60), the one line beside a coin in the market's «New» column.
 * Public data only, as the market is: no person, no wallet. The edge keeps an answer for 30 seconds.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  const limits = rateLimitHeaders(rate);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: limits });
  const params = new URL(request.url).searchParams;
  const headers = { ...apiHeaders(), ...publicCacheHeaders(30, 120), ...limits };
  if (params.get("part") === "checks") {
    const mints = mintsOf(params.get("mints"));
    const checks = await readScoutChecks(mints).catch(() => null);
    if (!checks) return apiFailure("UNAVAILABLE", "The Scout did not answer. Try again.", { headers: limits });
    return NextResponse.json(checks, { headers });
  }
  const view = await readScout().catch(() => null);
  if (!view) return apiFailure("UNAVAILABLE", "The Scout did not answer. Try again.", { headers: limits });
  return NextResponse.json(view, { headers });
}
