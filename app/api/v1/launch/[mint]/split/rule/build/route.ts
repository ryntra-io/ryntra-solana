import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchSplitRuleBuildRequestSchema, type LaunchSplitRuleBuildResponse } from "@/lib/api/v1/contract";
import { launchNetwork } from "@/lib/launch/config.server";
import { prepareSplitRule } from "@/lib/launch/creator-split.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/split/rule/build` — the creator's rule dividing their own share (SOL-L2b): checked to hold
 * and, with one in force, to raise it; the transaction for the creator to sign is a memo carrying the rule, the creator
 * among its signers. Only the token's creator. CAPABILITY_UNAVAILABLE where the split is not open.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchTradingDeps();
  if (!base) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("claimBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchSplitRuleBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const answer = await prepareSplitRule(deps, { token: mint, ...read.body }).catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!answer.ok) return apiFailure(answer.code, answer.message, answer.issues ? { issues: answer.issues } : {});
  return apiJson(answer.build satisfies LaunchSplitRuleBuildResponse);
}
