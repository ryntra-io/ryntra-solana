import { BASE58, LaunchEarlyAccessActionSubmitRequestSchema, type LaunchEarlyAccessActionSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { earlyAccessTradingDeps } from "@/lib/launch/early-access-runtime.server";
import { submitEarlyAccessAction } from "@/lib/launch/early-access.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/early-access/action/submit` (SOL-L5) — the action the wallet signed: the built bytes, with
 * only the wallet's own fee and guard instructions added, signed; sent once. `PENDING` — sent and not confirmed in
 * time: the page reads the vault, never send again.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = earlyAccessTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("tradeSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchEarlyAccessActionSubmitRequestSchema, 12_000);
  if (!read.ok) return read.response;
  const submitted = await submitEarlyAccessAction(deps, mint, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if it was sent, the page shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson({ state: submitted.state, signature: submitted.signature } satisfies LaunchEarlyAccessActionSubmitResponse);
}
