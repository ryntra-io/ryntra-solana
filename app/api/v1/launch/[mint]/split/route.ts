import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import type { LaunchSplitView } from "@/lib/api/v1/contract";
import { launchNetwork } from "@/lib/launch/config.server";
import { creatorSplitView } from "@/lib/launch/creator-split.server";
import { launchMarketDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/{mint}/split` — the creator's division of their own share (SOL-L2b): the rule in force and its
 * lines as the token's page shows them before a purchase, what it owes and what was done, the creator's depth steps and
 * each payout round with its rows and root; for a launch with no rule, the empty split. Public; read while Launch is
 * paused too. A read that fails says «not read», never zero.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchMarketDeps();
  if (!base) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const view = await creatorSplitView(deps, mint).catch(() => undefined);
  if (view === undefined) return apiFailure("UNAVAILABLE", "The split could not be read now.");
  if (!view) return apiFailure("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return apiJson(view satisfies LaunchSplitView);
}
