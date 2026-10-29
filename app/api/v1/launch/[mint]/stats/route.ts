import { BASE58, type LaunchStatsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchStats } from "@/lib/launch/creator-stats.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/stats` (contract 1.49.0) — a launch as its
 * creator's cabinet and public profile read it: what the creator's side earned
 * over the last day and week by source, the volume, the holders, the traders
 * and those who came back, the liquidity, after the DEX the depth ±2 % and the
 * pool's fees, the creator's own trades and lock. Public: all of it is on chain.
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
    const stats = await readLaunchStats(deps, mint);
    if (!stats) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here, or its creation is not confirmed yet.");
    return apiJson(stats satisfies LaunchStatsResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  }
}
