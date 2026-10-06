import { BASE58, type LaunchCreatorResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readCreatorLaunches } from "@/lib/launch/market.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/creator` (contract 1.27.0) — the creator's other
 * Ryntra launches and what became of each: how far its curve went, whether it
 * graduated, what share of what they bought the creator sold. Read after the
 * market, so the page never waits for it. Public.
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
    const creator = await readCreatorLaunches(deps, mint);
    if (!creator) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
    return apiJson(creator satisfies LaunchCreatorResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  }
}
