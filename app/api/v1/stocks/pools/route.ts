import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { publicCacheHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readPoolsShelf } from "@/lib/stocks/pools-shelf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A cold read of the universe and of the program can take seconds; every warm one is memory. */
export const maxDuration = 30;

/**
 * `GET /api/v1/stocks/pools?mint=<base58>`: a stock's pools on Meteora DLMM and DLMM Pro, as its page
 * shows them — the pair, the depth, the fee now, a day's volume, the limit bonus where the stock's limits rest, and
 * whether the engine's own deposit or ladder takes new money there (`lib/stocks/pools-shelf.ts`). A coin that is no
 * stock answers `isStock: false` and no pools. Reading only, public as the stock pages are; the read budget of the
 * Solana routes bounds it per address, the edge keeps an answer a minute, and the process one per mint.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  const limits = rateLimitHeaders(rate);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many reads from this address; wait a minute.", { headers: limits });
  const mint = new URL(request.url).searchParams.get("mint") ?? "";
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint must be a Solana address.", { headers: limits });
  const shelf = await readPoolsShelf(mint).catch(() => null);
  if (!shelf) return apiFailure("UNAVAILABLE", "The stocks could not be read right now; ask again in a minute.", { headers: limits });
  return apiJson({ shelf }, 200, { ...publicCacheHeaders(60, 120), ...limits, Vary: "X-Ryntra-API" });
}
