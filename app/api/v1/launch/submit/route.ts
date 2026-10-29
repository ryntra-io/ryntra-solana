import { LaunchSubmitRequestSchema, type LaunchSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { submitLaunch } from "@/lib/launch/flow.server";
import { consumeSharedLaunchWrite, launchDeps, launchFailureCode } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/submit` (contract 1.25.0) — the bytes the creator's
 * wallet signed first, each the built message (the lock and the sharing may
 * carry what a wallet adds on signing). The build's fresh keys then sign over
 * the exact message the creator signed, every signature but the pool payer's
 * must be present and valid, and only then does Ryntra's pool payer sign; the creation is sent once and confirmed, then the lock and the
 * sharing of the creator's fees. Answers the
 * token's path; the token's own read says the rest.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("submit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchSubmitRequestSchema, 12_000);
  if (!read.ok) return read.response;
  /* A node that refuses mid-way is an answer the client can read: the token's page settles from the chain whether the creation landed. */
  const submitted = await submitLaunch(deps, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the launch was sent, its page shows it.");
  if (!submitted.ok) return apiFailure(launchFailureCode(submitted.code, request.headers), submitted.message);
  return apiJson({
    token: submitted.token,
    signature: submitted.signature,
    state: submitted.state,
    lock: submitted.lock,
    feeSharing: submitted.feeSharing ? { ...submitted.feeSharing, shares: [...submitted.feeSharing.shares] } : null,
    tokenPath: submitted.tokenPath,
  } satisfies LaunchSubmitResponse);
}
