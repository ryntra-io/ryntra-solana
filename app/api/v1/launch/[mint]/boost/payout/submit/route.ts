import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchBoostPayoutSubmitRequestSchema, type LaunchBoostPayoutSubmitResponse } from "@/lib/api/v1/contract";
import { submitBoostPayout } from "@/lib/launch/boost.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/boost/payout/submit` — the payout the creator signed: each transaction the built one, with
 * only the wallet's own fee and guard instructions added, signed; sent once, in order — after one that did not land the
 * rest are not sent. `PENDING` — sent, not confirmed in time: the page settles it; never send again.
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
  const read = await readApiBody(request, LaunchBoostPayoutSubmitRequestSchema, 64_000);
  if (!read.ok) return read.response;
  const submitted = await submitBoostPayout({ ...base, env: process.env }, { token: mint, ...read.body }).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the payout was sent, the token's page shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson(submitted.submit satisfies LaunchBoostPayoutSubmitResponse);
}
