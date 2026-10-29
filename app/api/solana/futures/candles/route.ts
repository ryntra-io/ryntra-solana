import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { SYMBOL, candlesCacheSeconds, isFuturesTimeframe } from "@/lib/phoenix/market-data";
import { readFuturesCandles } from "@/lib/phoenix/read.server";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * One Phoenix market's bars (B7): `?symbol=SOL&tf=1h` — the traded price's and the mark price's, for the core chart.
 * Public and read only; at the edge for five seconds on the minute's bars, up to thirty on the day's.
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const timeframe = url.searchParams.get("tf") ?? "1h";
  if (!SYMBOL.test(symbol)) return failure(400, "VALIDATION_ERROR", "A chart is addressed by its market's symbol.", rate);
  if (!isFuturesTimeframe(timeframe)) return failure(400, "VALIDATION_ERROR", "Unknown timeframe.", rate);
  const ttl = candlesCacheSeconds(timeframe);
  return answer(await readFuturesCandles(symbol, timeframe), rate, { ttl, stale: ttl });
}
