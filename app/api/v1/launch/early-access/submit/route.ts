import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { LaunchEarlyAccessSubmitRequestSchema, type LaunchEarlyAccessSubmitResponse } from "@/lib/api/v1/contract";
import { earlyAccessDeps } from "@/lib/launch/early-access-runtime.server";
import { submitEarlyAccess } from "@/lib/launch/early-access.server";
import { consumeSharedLaunchWrite } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/early-access/submit` (SOL-L5) — the three transactions the creator's wallet signed, each the
 * built message (or the same instructions with what a wallet adds on signing). The fresh keys then sign over the exact
 * message, and the mint, the pool and the vault go one after the other, each once; a step the route had no time for, or
 * whose answer did not come, is said as such, and the token's page settles it from the chain.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = earlyAccessDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launching is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("submit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, LaunchEarlyAccessSubmitRequestSchema, 16_000);
  if (!read.ok) return read.response;
  const submitted = await submitEarlyAccess(deps, read.body).catch(() => null);
  if (!submitted) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the launch was sent, its page shows it.");
  if (!submitted.ok) return apiFailure(submitted.code, submitted.message);
  return apiJson({
    mint: submitted.mint,
    pool: submitted.pool,
    vault: submitted.vault,
    state: submitted.state,
    steps: { MINT: { ...submitted.steps.MINT }, POOL: { ...submitted.steps.POOL }, VAULT: { ...submitted.steps.VAULT } },
    tokenPath: submitted.tokenPath,
  } satisfies LaunchEarlyAccessSubmitResponse);
}
