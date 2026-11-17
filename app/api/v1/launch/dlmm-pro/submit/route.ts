import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { LaunchPoolSubmitRequestSchema, type LaunchPoolSubmitResponse } from "@/lib/api/v1/contract";
import { dlmmProLaunchDeps } from "@/lib/launch-pool/runtime.server";
import { submitDlmmProLaunch } from "@/lib/launch-pool/engine.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/dlmm-pro/submit` — a signed step of a launch into a pool: each transaction the
 * built message (or the same with what a wallet adds on signing). The fresh keys then sign over the exact message, and
 * the step's transactions go one after the other, each once. A step whose answer did not come is said as such
 * (PENDING), and the next build settles it from the chain.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = dlmmProLaunchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("submit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchPoolSubmitRequestSchema, 20_000);
  if (!read.ok) return read.response;
  const submitted = await submitDlmmProLaunch(deps, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the step was sent, the launch shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson({
    mint: submitted.mint,
    pool: submitted.pool,
    stage: submitted.stage,
    state: submitted.state,
    signatures: [...submitted.signatures],
    reason: submitted.reason,
    next: submitted.next,
    opensAt: submitted.opensAt,
  } satisfies LaunchPoolSubmitResponse);
}
