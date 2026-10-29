import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { LaunchEarlyAccessBuildRequestSchema, type LaunchEarlyAccessBuildResponse } from "@/lib/api/v1/contract";
import { earlyAccessDeps } from "@/lib/launch/early-access-runtime.server";
import { prepareEarlyAccess } from "@/lib/launch/early-access.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/early-access/build` (SOL-L5) — «Пресейл і ранній доступ»: the three transactions the creator
 * signs — the honest Token-2022 mint with the whole supply, the DAMM v2 pool with an alpha vault and the creator's
 * position locked for ever, and the Meteora Alpha Vault people deposit into before trading opens. The bytes carry no
 * signature: the new mint's and the position NFT's fresh keys stay on the server, sealed, until `submit` brings the same
 * messages back signed by the creator. Ryntra signs nothing and takes nothing. Closed on mainnet.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const network = launchNetwork();
  if (!network) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = earlyAccessDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("build", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchEarlyAccessBuildRequestSchema);
  if (!read.ok) return read.response;
  const prepared = await prepareEarlyAccess(deps, read.body).catch(() => null);
  if (!prepared) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!prepared.ok) return apiFailure(prepared.code, prepared.message);
  return apiJson({
    buildId: prepared.buildId,
    network: deps.network.chain,
    unsignedWireBase64: [...prepared.unsignedWireBase64],
    mint: prepared.mint,
    pool: prepared.pool,
    vault: prepared.vault,
    schedule: prepared.schedule,
    lines: { uk: [...prepared.lines.uk], en: [...prepared.lines.en] },
    presaleBps: prepared.presaleBps,
    expiresAt: prepared.expiresAt,
    signableMs: prepared.signableMs,
  } satisfies LaunchEarlyAccessBuildResponse);
}
