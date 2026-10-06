import { BASE58, LaunchClaimBuildRequestSchema, type LaunchClaimBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { buildLaunchClaim } from "@/lib/launch/creator.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/claim/build` (contract 1.29.0) — «Забрати»: every
 * source of the creator's fees holding something now — the curve's creator
 * share, the creator's part of the graduation fee, the locked LP's fees — in
 * one transaction for the wallet to sign as the only signer and fee payer;
 * with shared fees, into the vault and the wallet's own share out of it. The
 * server keeps the bytes to compare the signed ones with, and signs nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("claimBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchClaimBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await buildLaunchClaim(deps, mint, read.body.wallet).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was built. Try again." }));
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson(built.build satisfies LaunchClaimBuildResponse);
}
