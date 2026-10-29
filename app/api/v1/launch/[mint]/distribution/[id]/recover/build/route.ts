import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchDistributionRecoverBuildRequestSchema, type LaunchDistributionRecoverBuildResponse } from "@/lib/api/v1/contract";
import { prepareDistributionRecover } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/distribution/{id}/recover/build` — the owner's cancellation of one row, only where the
 * campaign published before anybody claimed that its owner may: what has vested stays the recipient's and the rest
 * comes back. A campaign that published that nobody may cancel builds nothing here, whoever asks.
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
  const read = await readApiBody(request, LaunchDistributionRecoverBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const built = await prepareDistributionRecover(deps, { campaignId: id, owner: read.body.owner, wallet: read.body.wallet }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be read now; nothing was built. Try again.",
  }));
  if (!built.ok) return apiFailure(built.code, built.message, "issues" in built && built.issues ? { issues: built.issues } : {});
  return apiJson(built.build satisfies LaunchDistributionRecoverBuildResponse);
}
