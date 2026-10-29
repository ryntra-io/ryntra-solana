import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { SYMBOL } from "@/lib/phoenix/market-data";
import { readFuturesFunding } from "@/lib/phoenix/read.server";

import { answer, failure } from "../respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * One Phoenix market's funding rate now (PERP-4): `?symbol=SOL` — the rate as a per cent for its period, the period and
 * when Phoenix stated it. Public and read only; thirty seconds at the edge (Phoenix states a new rate once a period).
 */
export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!SYMBOL.test(symbol)) return failure(400, "VALIDATION_ERROR", "A funding rate is addressed by its market's symbol.", rate);
  return answer(await readFuturesFunding(symbol), rate, { ttl: 30, stale: 60 });
}
