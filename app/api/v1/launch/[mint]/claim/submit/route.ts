import { BASE58, LaunchClaimSubmitRequestSchema, type LaunchClaimSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { submitLaunchClaim } from "@/lib/launch/creator.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/claim/submit` (contract 1.29.0) — the claim the
 * wallet signed: each transaction the built one, with only the wallet's own
 * fee and guard instructions added, signed; sent once, then the receipt read
 * back from the programs' own events and the wallet's balance. `PENDING` —
 * sent and not confirmed in time: read the signature, never send again.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("claimSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchClaimSubmitRequestSchema, 16_000);
  if (!read.ok) return read.response;
  const submitted = await submitLaunchClaim(deps, mint, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the claim was sent, «Мої лаунчі» shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson(submitted.submit satisfies LaunchClaimSubmitResponse);
}
