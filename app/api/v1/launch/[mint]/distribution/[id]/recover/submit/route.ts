import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchDistributionRecoverSubmitRequestSchema, type LaunchDistributionRecoverSubmitResponse } from "@/lib/api/v1/contract";
import { submitDistributionRecover } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/distribution/{id}/recover/submit` — the owner's signed cancellation, sent as it was
 * built. The program splits the row itself: everything that had vested to the recipient, the rest to the owner.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string; id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchTradingDeps();
  if (!base) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("claimSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint, id } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  if (!/^[0-9a-f]{32}$/.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a campaign");
  const read = await readApiBody(request, LaunchDistributionRecoverSubmitRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const sent = await submitDistributionRecover(deps, { campaignId: id, buildId: read.body.buildId, owner: read.body.owner, signedWireBase64: read.body.signedWireBase64 }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be reached now. The cancellation may still have landed; read the campaign before building again.",
  }));
  if (!sent.ok) return apiFailure(sent.code, sent.message);
  return apiJson(sent.submit satisfies LaunchDistributionRecoverSubmitResponse);
}
