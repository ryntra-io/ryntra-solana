import { NextResponse } from "next/server";

import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { earnProGate } from "@/lib/earn-pro/gate";
import { earnProClosed, openEarnProRead } from "@/lib/earn-pro/http.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readProPools } from "@/lib/pro-pools/read.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/pro/pools` — every Meteora DLMM Pro pool of the network, read from the program's own accounts
 * (DLMM Pro has no Data API): the pair with names and logos, the price, the depth in dollars, the fee a swap pays now and
 * what a limit order keeps on top. Public and read-only; kept a minute. Closed wherever `RYNTRA_EARN_PRO` does not open
 * DLMM Pro.
 */
export async function GET(request: Request) {
  const door = openEarnProRead(request);
  if (!door.ok) return door.response;
  const gate = earnProGate(process.env);
  if (!gate.open) return earnProClosed(door.rate);
  const answer = await readProPools(gate.network).catch(() => undefined);
  if (answer === undefined) return apiFailure("UNAVAILABLE", "The chain did not answer for the pools. Try again.", { headers: rateLimitHeaders(door.rate) });
  return NextResponse.json(answer, { headers: { ...apiHeaders(), ...publicCacheHeaders(30, 60), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
