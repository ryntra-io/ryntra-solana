import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readPoolFacts } from "@/lib/stocks/pool-facts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A cold read of the universe can take seconds; every warm one is memory. */
export const maxDuration = 30;

/**
 * `GET /api/v1/stocks/pool-facts?mint=<base58>`: the facts a pool page shows when its coin is a stock —
 * whether it is one, its issuer, the exchange's session and when it next changes, the dividend guard's window and the
 * issuer's terms (`lib/stocks/pool-facts.ts`). Reading only, public as the stock pages are; the read budget of the
 * Solana routes bounds it per address, the edge keeps an answer for 30 seconds, and the universe it is cut from is the
 * server's warm copy.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  const limits = rateLimitHeaders(rate);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many reads from this address; wait a minute.", { headers: limits });
  const mint = new URL(request.url).searchParams.get("mint") ?? "";
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint must be a Solana address.", { headers: limits });
  const facts = await readPoolFacts(mint).catch(() => null);
  if (!facts) return apiFailure("UNAVAILABLE", "The stocks could not be read right now; ask again in a minute.", { headers: limits });
  return apiJson({ facts }, 200, { ...publicCacheHeaders(30, 120), ...limits, Vary: "X-Ryntra-API" });
}
