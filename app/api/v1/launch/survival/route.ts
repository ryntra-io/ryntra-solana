import type { LaunchSurvivalResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchHealthDeps } from "@/lib/launch/runtime.server";
import { readLaunchSurvival } from "@/lib/launch/survival.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/survival` (contract 1.55.0, SOL-L3) — the survival of
 * every market launched on Ryntra on this network at 7, 30 and 90 days, from
 * the chain: alive at day N when someone other than its creator and Ryntra's
 * own wallets traded it in the week up to day N, proven by that trade's
 * transaction; people's markets and Ryntra's own apart. Public: no wallet.
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
    return apiJson((await readLaunchSurvival(deps)) satisfies LaunchSurvivalResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The survival could not be read now; try again.");
  }
}
