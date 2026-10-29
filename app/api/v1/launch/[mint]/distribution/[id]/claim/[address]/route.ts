import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import type { LaunchDistributionClaimView } from "@/lib/api/v1/contract";
import { claimView } from "@/lib/launch/distribution.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchMarketDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/{mint}/distribution/{id}/claim/{address}` — one wallet's claim panel: what the published list
 * owes it, what it has taken, what is left, when the next part unlocks, and the chain's own receipt for each claim.
 * Public chain facts, read by the address alone; a read that fails says «not read» and states no figure.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string; id: string; address: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const base = launchMarketDeps();
  if (!base) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint, id, address } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  if (!BASE58.test(address)) return apiFailure("VALIDATION_ERROR", "address: not an address");
  if (!/^[0-9a-f]{32}$/.test(id)) return apiFailure("VALIDATION_ERROR", "id: not a campaign");
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const view = await claimView(deps, id, address).catch(() => undefined);
  if (view === undefined) return apiFailure("UNAVAILABLE", "The claim could not be read now.");
  if (!view) return apiFailure("LAUNCH_NOT_FOUND", "No such campaign here.");
  return apiJson(view satisfies LaunchDistributionClaimView);
}
