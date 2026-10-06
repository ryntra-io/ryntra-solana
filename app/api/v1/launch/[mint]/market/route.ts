import { BASE58, type LaunchMarketResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchMarket } from "@/lib/launch/market.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/market` (contract 1.27.0) — a Ryntra launch's
 * market as the chain shows it now: the price and market cap, the curve's way
 * to the DEX and its fee now, the holders with their labels and the groups'
 * shares, the trades, the chart, the facts of risk with what each rests on,
 * and the creator's other launches. Public.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  try {
    const market = await readLaunchMarket(deps, mint);
    if (!market) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here, or its creation is not confirmed yet.");
    return apiJson(market satisfies LaunchMarketResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  }
}
