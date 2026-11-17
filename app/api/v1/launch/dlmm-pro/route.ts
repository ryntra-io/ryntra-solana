import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import type { LaunchPoolListResponse } from "@/lib/api/v1/contract";
import { dlmmProLaunchReadDeps } from "@/lib/launch-pool/runtime.server";
import { listDlmmProLaunches } from "@/lib/launch-pool/engine.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/dlmm-pro` — the launches into a pool Ryntra keeps on this network, newest first: each
 * with its coin, its pool, its opening time and where it stands by its own record. One read of the store, none of the
 * chain: a tower's own view (`/{mint}`) reads the chain. Public.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = dlmmProLaunchReadDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const launches = await listDlmmProLaunches(deps).catch(() => null);
  if (!launches) return apiFailure("UNAVAILABLE", "The launches could not be read now. Try again.");
  return apiJson({ network: deps.network.chain, launches: launches.map((launch) => ({ ...launch })) } satisfies LaunchPoolListResponse);
}
