import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { LaunchPoolBuildRequestSchema, type LaunchPoolBuildResponse } from "@/lib/api/v1/contract";
import { dlmmProLaunchDeps } from "@/lib/launch-pool/runtime.server";
import { prepareDlmmProLaunch } from "@/lib/launch-pool/engine.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/dlmm-pro/build` — a launch straight into a pool: the step the launch waits for, as
 * unsigned transactions the creator's wallet signs. A new launch names its stored details, its pair and — optionally —
 * when trading opens; a launch already begun names its coin, and the build is the step the chain shows is next: the
 * coin, the pool, the locked supply (and the creator's take-profit ladder, where asked). The bytes carry no signature:
 * the fresh keys — the mint's, each position's, the ladder's — stay
 * on the server, sealed, until `submit` brings the same messages back signed by the creator. Ryntra signs nothing.
 * Closed on mainnet.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const network = launchNetwork();
  if (!network) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = dlmmProLaunchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("build", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchPoolBuildRequestSchema);
  if (!read.ok) return read.response;
  const prepared = await prepareDlmmProLaunch(deps, read.body).catch(() => null);
  if (!prepared) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!prepared.ok) return apiFailure(prepared.code, prepared.message);
  return apiJson({
    buildId: prepared.buildId,
    network: deps.network.chain,
    stage: prepared.stage,
    unsignedWireBase64: [...prepared.unsignedWireBase64],
    mint: prepared.mint,
    pool: prepared.pool,
    pair: prepared.pair,
    opensAt: prepared.opensAt,
    feeLamports: prepared.feeLamports,
    rentLamports: prepared.rentLamports,
    remainingLamports: prepared.remainingLamports,
    fee: { ...prepared.fee },
    split: prepared.split ? { ...prepared.split } : null,
    ladder: prepared.ladder ? { ...prepared.ladder } : null,
    expiresAt: prepared.expiresAt,
    signableMs: prepared.signableMs,
  } satisfies LaunchPoolBuildResponse);
}
