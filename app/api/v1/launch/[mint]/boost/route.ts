import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import type { LaunchBoostView } from "@/lib/api/v1/contract";
import { boostView } from "@/lib/launch/boost.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchMarketDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/launch/{mint}/boost` — the token's creator campaign as the page shows it before a purchase: the rules
 * and their lines, what the escrow holds as the chain says, and the payout. Public; read while the lane is paused too.
 * A read that fails says «not read», never zero.
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
  const view = await boostView(deps, mint).catch(() => undefined);
  if (view === undefined) return apiFailure("UNAVAILABLE", "The campaign could not be read now.");
  if (!view) return apiFailure("LAUNCH_NOT_FOUND", "This token has no creator campaign.");
  return apiJson(view satisfies LaunchBoostView);
}
