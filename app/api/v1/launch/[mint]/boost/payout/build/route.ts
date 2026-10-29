import { BASE58 } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { LaunchBoostPayoutBuildRequestSchema, type LaunchBoostPayoutBuildResponse } from "@/lib/api/v1/contract";
import { prepareBoostPayout } from "@/lib/launch/boost.server";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/boost/payout/build` — once the campaign and its hold are over and the token's history was
 * read whole: the creator's transactions, to sign in one window — the escrow claimed back to the creator, then each
 * eligible wallet paid from there. Only the planned wallets receive anything, and no wallet of Ryntra's; the server
 * signs nothing.
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
  const read = await readApiBody(request, LaunchBoostPayoutBuildRequestSchema);
  if (!read.ok) return read.response;
  const deps = { ...base, env: process.env, ownWallets: () => ryntraOwnWallets(base.network, base.store) };
  const built = await prepareBoostPayout(deps, { token: mint, creator: read.body.creator }).catch(() => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    message: "The network could not be read now; nothing was built. Try again.",
  }));
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson(built.build satisfies LaunchBoostPayoutBuildResponse);
}
