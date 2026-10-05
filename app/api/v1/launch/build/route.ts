import { LaunchBuildRequestSchema, type LaunchBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { prepareLaunch } from "@/lib/launch/flow.server";
import { LAUNCH_FAILURE_CODES, consumeLaunchWrite, launchDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/build` (contract 1.25.0) — the creation the creator
 * signs: the token on the preset's config, the first purchase under its cap,
 * and first of all the creator paying Ryntra's pool payer back the rent and
 * fee the network simulated; with the lock of the purchase as a second
 * transaction when chosen. The server keeps only the hash of each message; it
 * signs nothing until `submit` brings the same bytes back signed.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused for a moment; try again later.");
  const rate = consumeLaunchWrite("build", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchBuildRequestSchema);
  if (!read.ok) return read.response;
  const prepared = await prepareLaunch(deps, read.body);
  if (!prepared.ok) return apiFailure(LAUNCH_FAILURE_CODES[prepared.code], prepared.message);
  return apiJson({
    buildId: prepared.buildId,
    network: deps.network.chain,
    unsignedWireBase64: prepared.wireBase64,
    lockUnsignedWireBase64: prepared.lockWireBase64,
    token: prepared.token,
    firstBuyOutRaw: prepared.firstBuyOutRaw,
    payerCoveredLamports: prepared.payerCoveredLamports,
    creatorCostLamports: prepared.creatorCostLamports,
    expiresAt: prepared.expiresAt,
  } satisfies LaunchBuildResponse);
}
