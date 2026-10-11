import { BASE58, LaunchHolderBuildRequestSchema, type LaunchHolderBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { buildLaunchHolder } from "@/lib/launch/holder.server";
import { provenWalletOf } from "@/lib/launch/holder-proof.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/holder/build` (contract 1.33.0) — the entry for
 * the wallet to sign: one transaction — its token accounts, Ryntra's share at
 * entry where it is charged, a new position (its NFT's fresh key has signed
 * the creation), Zap's ledger and `zap_in_damm_v2`, and Ryntra's collector's
 * permission where the network has one. The wallet must hold the amount. The
 * server keeps the bytes to compare the signed ones with.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was built.");
  const rate = await consumeSharedLaunchWrite("holderBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchHolderBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await buildLaunchHolder({ ...deps, proven: provenWalletOf(request) }, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was built. Try again." }));
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson(built.build satisfies LaunchHolderBuildResponse);
}
