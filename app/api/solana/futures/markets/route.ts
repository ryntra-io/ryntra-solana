import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { readFuturesMarkets } from "@/lib/phoenix/read.server";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Phoenix's perpetual markets with their latest prices, volume and leverage — «Торгівля → Ф'ючерси» (B7). Public and
 * read only; five seconds at the edge.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  return answer(await readFuturesMarkets(), rate, { ttl: 5, stale: 30 });
}
