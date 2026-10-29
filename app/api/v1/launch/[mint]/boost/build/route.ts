import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchBoostBuildRequestSchema, type LaunchBoostBuildResponse } from "@/lib/api/v1/contract";
import { prepareBoost } from "@/lib/launch/boost.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/boost/build` the whole budget into Met Lock's escrow from the creator to the
 * creator, unlocking when the campaign and its hold are over, which nobody may cancel or redirect. The creator signs
 * first; the escrow's fresh base key waits sealed for the submit. Ryntra takes 0.
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
  const read = await readApiBody(request, LaunchBoostBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const built = await prepareBoost(deps, { token: mint, creator: read.body.creator, rules: read.body.rules }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be read now; nothing was built. Try again.",
  }));
  if (!built.ok) return apiFailure(built.code, built.message, "issues" in built && built.issues ? { issues: built.issues } : {});
  return apiJson(built.build satisfies LaunchBoostBuildResponse);
}
