import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import type { LaunchDistributionList } from "@/lib/api/v1/contract";
import { campaignView, readCampaignsOfToken } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchMarketDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/{mint}/distribution` — the token's distribution campaigns: each one's stage, its Review, the
 * chain against its published list, what is left and its report. Public; a read that fails says so, never zero.
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
  const stored = await readCampaignsOfToken(base.store, base.network.cluster, mint).catch(() => undefined);
  if (stored === undefined) return apiFailure("UNAVAILABLE", "The campaigns could not be read now.");
  const campaigns = [];
  for (const row of stored.slice(0, 20)) {
    const view = await campaignView(deps, row.id).catch(() => null);
    if (view) campaigns.push(view);
  }
  return apiJson({ network: base.network.chain, token: mint, campaigns, observedAt: base.now().toISOString() } satisfies LaunchDistributionList);
}
