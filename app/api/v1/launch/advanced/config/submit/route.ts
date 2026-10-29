import { LaunchAdvancedConfigSubmitRequestSchema, type LaunchAdvancedConfigSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { submitAdvancedConfig } from "@/lib/launch/advanced.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchDeps, launchFailureCode } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/advanced/config/submit` (contract 1.56.0, SOL-L5) — the config's bytes the creator signed, exactly
 * as built; its own key then signs, and it is sent once. Answers the config the launch's build names.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("submit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchAdvancedConfigSubmitRequestSchema, 8_000);
  if (!read.ok) return read.response;
  const submitted = await submitAdvancedConfig(deps, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; build the config again if it does not appear.");
  if (!submitted.ok) return apiFailure(launchFailureCode(submitted.code, request.headers), submitted.message);
  return apiJson({ config: submitted.config, signature: submitted.signature, state: submitted.state, terms: submitted.terms } satisfies LaunchAdvancedConfigSubmitResponse);
}
