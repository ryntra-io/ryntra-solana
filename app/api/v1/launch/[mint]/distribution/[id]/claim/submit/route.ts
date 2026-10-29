import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchDistributionClaimSubmitRequestSchema, type LaunchDistributionClaimSubmitResponse } from "@/lib/api/v1/contract";
import { submitDistributionClaim } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/distribution/{id}/claim/submit` — the recipient's signed claim, sent as it was built. A
 * repeated send of the same build is refused here, and a repeated claim of the row is refused by the program itself.
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
  const read = await readApiBody(request, LaunchDistributionClaimSubmitRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const sent = await submitDistributionClaim(deps, { campaignId: id, buildId: read.body.buildId, wallet: read.body.wallet, signedWireBase64: read.body.signedWireBase64 }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be reached now. The claim may still have landed; read the panel before building again.",
  }));
  if (!sent.ok) return apiFailure(sent.code, sent.message);
  return apiJson(sent.submit satisfies LaunchDistributionClaimSubmitResponse);
}
