import { NextResponse } from "next/server";

import type { EarnBinsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiHeaders } from "@/lib/api/v1/http";
import { binsHalfOf, isPoolAddress } from "@/lib/earn-pools/bins";
import { readProBins } from "@/lib/earn-pro/bins.server";
import { earnProGate } from "@/lib/earn-pro/gate";
import { earnProClosed, openEarnProRead } from "@/lib/earn-pro/http.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `GET /api/v1/earn/pro/bins?pool=&half=` — a Meteora DLMM Pro pool's liquidity by price,
 * in the same shape as a DLMM pool's bins: the steps of its tick spacing around the price, each with what the
 * liquidity in range holds there, and where Jupiter prices the pair. Public and read-only; kept twenty seconds. Closed
 * wherever `RYNTRA_EARN_PRO` does not open earning on DLMM Pro.
 */
export async function GET(request: Request) {
  const door = openEarnProRead(request);
  if (!door.ok) return door.response;
  const gate = earnProGate(process.env);
  if (!gate.open) return earnProClosed(door.rate);
  const query = new URL(request.url).searchParams;
  const pool = query.get("pool");
  const half = binsHalfOf(query.get("half"));
  if (!isPoolAddress(pool)) return apiFailure("VALIDATION_ERROR", "pool: a pool's address.", { headers: rateLimitHeaders(door.rate) });
  if (half === null) return apiFailure("VALIDATION_ERROR", "half: a whole number of steps each side, 1 to 70.", { headers: rateLimitHeaders(door.rate) });
  const answer = await readProBins(gate.network, pool, half).catch(() => undefined);
  if (answer === undefined) return apiFailure("UNAVAILABLE", "The chain did not answer for the pool. Try again.", { headers: rateLimitHeaders(door.rate) });
  if (answer === null) return apiFailure("EARN_PRO_NOT_A_PIER", "No Meteora DLMM Pro pool at the address.", { headers: rateLimitHeaders(door.rate) });
  const body: EarnBinsResponse = { ...answer, bins: [...answer.bins], rent: null };
  return NextResponse.json(body, { headers: { ...apiHeaders(), ...publicCacheHeaders(15, 30), ...rateLimitHeaders(door.rate), Vary: "X-Ryntra-API" } });
}
