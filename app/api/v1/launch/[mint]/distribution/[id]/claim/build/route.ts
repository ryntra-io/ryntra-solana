import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchDistributionClaimBuildRequestSchema, type LaunchDistributionClaimBuildResponse } from "@/lib/api/v1/contract";
import { prepareDistributionClaim } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/distribution/{id}/claim/build` — a recipient's own claim: their row and its proof make
 * their escrow and `claim_v2` pays what has vested. The wallet asking is the only signer and the only payer, so the
 * campaign's owner is not in the transaction at all — and a row already taken builds nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string; id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchTradingDeps();
  if (!base) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("claimBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint, id } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  if (!/^[0-9a-f]{32}$/.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a campaign");
  const read = await readApiBody(request, LaunchDistributionClaimBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const built = await prepareDistributionClaim(deps, { campaignId: id, wallet: read.body.wallet }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be read now; nothing was built. Try again.",
  }));
  if (!built.ok) return apiFailure(built.code, built.message, "issues" in built && built.issues ? { issues: built.issues } : {});
  return apiJson(built.build satisfies LaunchDistributionClaimBuildResponse);
}
