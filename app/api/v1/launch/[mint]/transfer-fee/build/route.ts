import { BASE58, LaunchTransferFeeBuildRequestSchema, type LaunchTransferFeeBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";
import { buildLaunchTransferFeeStep } from "@/lib/launch/transfer-fee.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/transfer-fee/build` (contract 1.72.0, SOL-L10) — one step of the withheld cycle for the
 * creator's wallet to sign as the only signer and fee payer: `HARVEST` — holders' accounts to the mint; `WITHDRAW` — the
 * mint to the creator's own token account. A step with nothing to move is not built. The server signs nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("claimBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTransferFeeBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await buildLaunchTransferFeeStep(deps, mint, read.body).catch(() => null);
  if (!built) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson(built.build satisfies LaunchTransferFeeBuildResponse);
}
