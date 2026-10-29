import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { SYMBOL } from "@/lib/phoenix/market-data";
import { readFuturesBook } from "@/lib/phoenix/read.server";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** One Phoenix market's order book (B7): `?symbol=SOL`. Public and read only; one second at the edge. */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!SYMBOL.test(symbol)) return failure(400, "VALIDATION_ERROR", "A book is addressed by its market's symbol.", rate);
  return answer(await readFuturesBook(symbol), rate, { ttl: 1, stale: 1 });
}
