import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { LaunchEarlyAccessDepositBuildRequestSchema, type LaunchEarlyAccessDepositBuildResponse } from "@/lib/api/v1/contract";
import { earlyAccessTradingDeps } from "@/lib/launch/early-access-runtime.server";
import { prepareEarlyAccessDeposit } from "@/lib/launch/early-access.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/early-access/deposit/build` (SOL-L5) — a deposit of USDC into the launch's alpha vault
 * while deposits are open, for the wallet to sign as the fee payer and only signer; its escrow opened first when it has
 * none (no fee). Refused above what the wallet may still deposit on a first-come vault. The server keeps the bytes to
 * compare the signed ones with, and signs nothing.
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
  const read = await readApiBody(request, LaunchEarlyAccessDepositBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await prepareEarlyAccessDeposit(deps, mint, read.body).catch(() => null);
  if (!built) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson({
    buildId: built.buildId,
    network: deps.network.chain,
    unsignedWireBase64: built.unsignedWireBase64,
    escrow: built.escrow,
    opensEscrow: built.opensEscrow,
    amountRaw: built.amountRaw,
    expiresAt: built.expiresAt,
    signableMs: built.signableMs,
  } satisfies LaunchEarlyAccessDepositBuildResponse);
}
