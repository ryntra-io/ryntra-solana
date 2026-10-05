import { BASE58, type LaunchTokenResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchDeps } from "@/lib/launch/runtime.server";
import { readLaunchView } from "@/lib/launch/view.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/{mint}` (contract 1.25.0) — a Ryntra launch as the chain
 * shows it now: the receipt's facts and marks, the creator's lock when it
 * holds, the curve's progress, and the link the creator shares. Public.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused for a moment; try again later.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const view = await readLaunchView({ ...deps, poolPayer: deps.poolPayer.publicKey.toBase58() }, mint);
  if (!view) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return apiJson(view satisfies LaunchTokenResponse);
}
