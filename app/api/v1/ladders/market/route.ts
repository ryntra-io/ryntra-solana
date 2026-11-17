import { BASE58, type LadderMarketResponse } from "@/lib/api/v1/contract";
import { apiFailure } from "@/lib/api/v1/http";
import { ladderAnswer, ladderRefusal } from "@/lib/pro-limits/http.server";
import { readProMarket } from "@/lib/pro-limits/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/ladders/market?mint=` — the pool a coin's ladder would rest in: its price,
 * the maker's bonus as one number, how far a ladder may reach. `market` is null where the coin has none. Read-only.
 */
export async function GET(request: Request) {
  const refused = ladderRefusal(request, "read");
  if (refused) return refused;
  const mint = new URL(request.url).searchParams.get("mint") ?? "";
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  return ladderAnswer(await readProMarket(mint), (market) => ({ market }) satisfies LadderMarketResponse);
}
