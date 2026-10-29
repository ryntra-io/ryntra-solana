import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchSplitPayoutSubmitRequestSchema, type LaunchSplitPayoutSubmitResponse } from "@/lib/api/v1/contract";
import { launchNetwork } from "@/lib/launch/config.server";
import { submitSplitPayout } from "@/lib/launch/creator-split.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/split/payout/submit` — the signed payout: each transaction the built one, with only the
 * wallet's own fee and guard instructions added, signed; sent once, in order, the root first — after one that did not
 * land the rest are not sent. PENDING — sent, not confirmed in time: the page settles it; never send again.
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
  const read = await readApiBody(request, LaunchSplitPayoutSubmitRequestSchema, 64_000);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const answer = await submitSplitPayout(deps, { token: mint, ...read.body }).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the payout was sent, the token's page shows it.");
  if (!answer.ok) return apiFailure(answer.code, answer.message, answer.issues ? { issues: answer.issues } : {});
  return apiJson(answer.submit satisfies LaunchSplitPayoutSubmitResponse);
}
