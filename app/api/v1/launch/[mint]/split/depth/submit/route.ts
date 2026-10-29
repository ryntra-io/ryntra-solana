import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchSplitSubmitRequestSchema, type LaunchSplitDepthSubmitResponse } from "@/lib/api/v1/contract";
import { launchNetwork } from "@/lib/launch/config.server";
import { submitSplitDepth } from "@/lib/launch/creator-split.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/split/depth/submit` — the signed depth act: the built message, or the same instructions with
 * only a wallet's own additions; a new position's key signs after, and it is sent once. PENDING — sent, not confirmed in
 * time: the page settles it; never send again.
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
  const read = await readApiBody(request, LaunchSplitSubmitRequestSchema, 16_000);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const answer = await submitSplitDepth(deps, { token: mint, ...read.body }).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "No answer could be read from the network now; if the act was sent, the token's page shows it.");
  if (!answer.ok) return apiFailure(answer.code, answer.message, answer.issues ? { issues: answer.issues } : {});
  return apiJson(answer.submit satisfies LaunchSplitDepthSubmitResponse);
}
