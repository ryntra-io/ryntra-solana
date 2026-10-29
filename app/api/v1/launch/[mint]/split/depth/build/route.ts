import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchSplitActBuildRequestSchema, type LaunchSplitDepthBuildResponse } from "@/lib/api/v1/contract";
import { launchNetwork } from "@/lib/launch/config.server";
import { prepareSplitDepth } from "@/lib/launch/creator-split.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/split/depth/build` — after the DEX, what the rule owes depth into the creator's buy steps in
 * the token's DLMM pool, from the creator's wallet, below the lower of the graduated pool's price and the DLMM pool's
 * own (POOL first where the token has no DLMM pool). The creator signs first; a new position's fresh key waits sealed.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchTradingDeps();
  if (!base) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("claimBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchSplitActBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const answer = await prepareSplitDepth(deps, { token: mint, ...read.body }).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!answer.ok) return apiFailure(answer.code, answer.message, answer.issues ? { issues: answer.issues } : {});
  return apiJson(answer.build satisfies LaunchSplitDepthBuildResponse);
}
