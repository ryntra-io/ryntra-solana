import { BASE58, type LaunchTransferFeeResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";
import { readLaunchTransferFee } from "@/lib/launch/transfer-fee.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/transfer-fee` (contract 1.72.0, SOL-L10) — «Комісія за переказ»: the rate, the RevokeZeroFee
 * timeline by epoch, and the withheld cycle — in holders' accounts, harvested to the mint, withdrawn by the creator —
 * each step with its transaction. Public; `LAUNCH_NO_TRANSFER_FEE` for a token that takes no fee on transfers.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readLaunchTransferFee(deps, mint).catch(() => null);
  if (!read) return apiFailure("UNAVAILABLE", "The chain could not be read now; try again.");
  if (!read.ok) return apiFailure(read.code, read.message);
  return apiJson(read.view satisfies LaunchTransferFeeResponse);
}
