import { NextResponse } from "next/server";

import type { EarnProPiersResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { openEarnProRead, earnProClosed } from "@/lib/earn-pro/http.server";
import { earnProPiersAnswer } from "@/lib/earn-pro/service.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/earn/pro/piers` — the piers of Meteora DLMM Pro: its pools of SOL against a
 * coin Earn knows, read from the chain — the program has no Data API — with each one's price, fee now, depth in SOL
 * and reward. Public; kept a minute. Closed wherever `RYNTRA_EARN_PRO` does not open it.
 */
export async function GET(request: Request) {
  const door = openEarnProRead(request);
  if (!door.ok) return door.response;
  const answer = await earnProPiersAnswer().catch(() => undefined);
  if (answer === undefined) return apiFailure("UNAVAILABLE", "The chain did not answer for the piers. Try again.", { headers: rateLimitHeaders(door.rate) });
  if (answer === null) return earnProClosed(door.rate);
  return NextResponse.json(answer satisfies EarnProPiersResponse, { headers: { ...apiHeaders(), ...publicCacheHeaders(30, 60), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
