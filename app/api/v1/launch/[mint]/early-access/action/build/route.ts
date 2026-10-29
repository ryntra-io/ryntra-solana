import { BASE58, LaunchEarlyAccessActionBuildRequestSchema, type LaunchEarlyAccessActionBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { earlyAccessTradingDeps } from "@/lib/launch/early-access-runtime.server";
import { prepareEarlyAccessAction } from "@/lib/launch/early-access.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/early-access/action/build` (SOL-L5) — after the deposits: CLAIM the tokens vested so far,
 * WITHDRAW_REMAINING the USDC the vault did not spend (once trading opens), WITHDRAW a Pro Rata deposit (while deposits
 * are open), or FILL — the vault's purchase, a permissionless crank any wallet may send and pay for, in the hour before
 * trading opens. For the wallet to sign as the fee payer and only signer; the server keeps the bytes and signs nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = earlyAccessTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("tradeBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchEarlyAccessActionBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await prepareEarlyAccessAction(deps, mint, read.body).catch(() => null);
  if (!built) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson({
    buildId: built.buildId,
    network: deps.network.chain,
    unsignedWireBase64: built.unsignedWireBase64,
    action: built.action,
    amountRaw: built.amountRaw,
    expiresAt: built.expiresAt,
    signableMs: built.signableMs,
  } satisfies LaunchEarlyAccessActionBuildResponse);
}
