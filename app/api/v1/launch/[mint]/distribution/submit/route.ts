import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchDistributionSubmitRequestSchema, type LaunchDistributionSubmitResponse } from "@/lib/api/v1/contract";
import { submitDistribution } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/distribution/submit` — the owner's signed commitment, sent as it was built: the root on
 * chain and the money locked behind it. Once this lands the owner signs nothing more; the campaign runs without them.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchTradingDeps();
  if (!base) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("claimSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchDistributionSubmitRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const sent = await submitDistribution(deps, { token: mint, buildId: read.body.buildId, owner: read.body.owner, signedWireBase64: read.body.signedWireBase64 }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be reached now. The campaign may still have landed; read it before building again.",
  }));
  if (!sent.ok) return apiFailure(sent.code, sent.message);
  return apiJson(sent.submit satisfies LaunchDistributionSubmitResponse);
}
