import { LaunchAdvancedConfigBuildRequestSchema, type LaunchAdvancedConfigBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { prepareAdvancedConfig } from "@/lib/launch/advanced.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchDeps, launchFailureCode } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/advanced/config/build` (contract 1.56.0, SOL-L5) — «Розширений»: the config of one launch, made
 * from the creator's choice within the operator's bounds. The creator signs it first and pays its rent; its fresh key stays
 * on the server, sealed, until `submit` brings the same message back signed. Offered only where the bounds are.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("build", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchAdvancedConfigBuildRequestSchema);
  if (!read.ok) return read.response;
  const prepared = await prepareAdvancedConfig(deps, read.body).catch(() => null);
  if (!prepared) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!prepared.ok) return apiFailure(launchFailureCode(prepared.code, request.headers), prepared.message);
  return apiJson({
    buildId: prepared.buildId,
    network: deps.network.chain,
    config: prepared.config,
    unsignedWireBase64: prepared.wireBase64,
    terms: prepared.terms,
    creatorCostLamports: prepared.creatorCostLamports,
    expiresAt: prepared.expiresAt,
    signableMs: prepared.signableMs,
  } satisfies LaunchAdvancedConfigBuildResponse);
}
