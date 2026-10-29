import { BASE58, type LaunchCreatorProfileResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readCreatorProfile } from "@/lib/launch/creator-stats.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/creators/{address}/profile` (contract 1.49.0) — a
 * creator's public profile: the launches the wallet made through Ryntra, the
 * newest first; each one's figures — results, lock and sales — are its own
 * `…/stats`. Public: who created a token is on chain.
 */
export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { address } = await context.params;
  if (!BASE58.test(address)) return apiFailure("VALIDATION_ERROR", "address: not a wallet");
  const profile = await readCreatorProfile(deps, address).catch(() => null);
  if (!profile) return apiFailure("UNAVAILABLE", "The launches could not be read now. Try again.");
  return apiJson(profile satisfies LaunchCreatorProfileResponse);
}
