import { NextResponse } from "next/server";

import type { EarnBinsResponse } from "@/lib/api/v1/contract";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { binsHalfOf, isPoolAddress } from "@/lib/earn-pools/bins";
import { readDlmmBins } from "@/lib/earn-pools/bins.server";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `GET /api/v1/earn/pools/bins?pool=&half=` — a Meteora DLMM pool's liquidity by price: the
 * bins around its active bin, each with what lies on it of the two coins; what a new position's accounts cost and give
 * back; and where Jupiter prices the pair, with how far the pool stands from it. Public and read-only; kept twenty
 * seconds in the process and fifteen at the edge.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const query = new URL(request.url).searchParams;
  const pool = query.get("pool");
  const half = binsHalfOf(query.get("half"));
  if (!isPoolAddress(pool)) return apiFailure("VALIDATION_ERROR", "pool: a pool's address.", { headers: rateLimitHeaders(rate) });
  if (half === null) return apiFailure("VALIDATION_ERROR", "half: a whole number of bins each side, 1 to 70.", { headers: rateLimitHeaders(rate) });
  const read = await readDlmmBins(pool, half);
  if (!read.ok) {
    /* No pool there — nothing, another program's account, or a text that is no address at all. */
    return read.code === "NOT_A_POOL"
      ? apiFailure("VALIDATION_ERROR", "pool: no Meteora DLMM pool at the address.", { headers: rateLimitHeaders(rate) })
      : apiFailure("UNAVAILABLE", "The chain did not answer for the pool. Try again.", { headers: rateLimitHeaders(rate) });
  }
  const answer = read.value;
  const body: EarnBinsResponse = { ...answer, bins: [...answer.bins], rent: answer.rent ? { ...answer.rent, ledgers: [...answer.rent.ledgers] } : null };
  return NextResponse.json(body, { headers: { ...apiHeaders(), ...publicCacheHeaders(15, 30), ...rateLimitHeaders(rate), Vary: "X-Ryntra-API" } });
}
