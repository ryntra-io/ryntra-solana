import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchBoostSubmitRequestSchema, type LaunchBoostSubmitResponse } from "@/lib/api/v1/contract";
import { submitBoost } from "@/lib/launch/boost.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/boost/submit` — the commitment the creator signed: the built message, or the same
 * instructions with only a wallet's own additions; the escrow's base signs after, and it is sent once. `PENDING` — sent
 * and not confirmed in time: the page settles it from the escrow's own address; never send again.
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
  const read = await readApiBody(request, LaunchBoostSubmitRequestSchema, 16_000);
  if (!read.ok) return read.response;
  const submitted = await submitBoost({ ...base, env: process.env }, { token: mint, ...read.body }).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the campaign was sent, the token's page shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson(submitted.submit satisfies LaunchBoostSubmitResponse);
}
