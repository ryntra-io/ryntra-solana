import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchDistributionBuildRequestSchema, type LaunchDistributionBuildResponse } from "@/lib/api/v1/contract";
import { prepareDistribution } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/distribution/build` — the owner's draft into the one transaction they sign: the list
 * counted and judged, the root written and funded with exactly what the list adds up to, never a unit more. Nothing is
 * signed or sent here, and Ryntra takes 0 of a campaign.
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
  const read = await readApiBody(request, LaunchDistributionBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const built = await prepareDistribution(deps, { token: mint, owner: read.body.owner, draft: read.body.draft, list: read.body.list }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be read now; nothing was built. Try again.",
  }));
  if (!built.ok) return apiFailure(built.code, built.message, "issues" in built && built.issues ? { issues: built.issues } : {});
  return apiJson(built.build satisfies LaunchDistributionBuildResponse);
}
