import { BASE58, LaunchTransferFeeSubmitRequestSchema, type LaunchTransferFeeSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";
import { submitLaunchTransferFeeStep } from "@/lib/launch/transfer-fee.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/transfer-fee/submit` (contract 1.72.0, SOL-L10) — the step the wallet signed: the built
 * bytes with only the wallet's own fee and guard instructions added; sent once, then its receipt kept with the
 * signature. `PENDING` — sent and not confirmed in time: read the signature, never send again.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("claimSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTransferFeeSubmitRequestSchema, 16_000);
  if (!read.ok) return read.response;
  const submitted = await submitLaunchTransferFeeStep(deps, mint, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the step was sent, «Мої лаунчі» shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson(submitted.submit satisfies LaunchTransferFeeSubmitResponse);
}
