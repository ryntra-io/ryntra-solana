import { after } from "next/server";

import type { LaunchMarketsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchMarkets, readMarketsBehind } from "@/lib/launch/markets.server";
import { launchHealthDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/markets` (contract 1.36.0) — every market launched on
 * Ryntra on this network, a row each: its state of the cycle, the curve's way
 * to the DEX, the pool's liquidity, the market's budget, depth at −5 %, days
 * since the DEX, holders and the creator; with a trade in the last day first.
 * Public: no wallet. A market not read in time, or read a while ago, is read
 * again behind the answer — the next answer has it.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchHealthDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  try {
    const list = await readLaunchMarkets(deps);
    after(() => readMarketsBehind());
    return apiJson(list satisfies LaunchMarketsResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The markets could not be read now; try again.");
  }
}
