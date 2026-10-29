import { BASE58, type LaunchClaimReviewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchClaimReview } from "@/lib/launch/creator.server";
import { consumeSharedLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/claim/review?wallet=` (contract 1.73.0, SOL-L12) — «Забрати все»: the Review before the
 * signature. Every pocket of the creator's side of the launch with what it holds and whether the claim takes it, the
 * transactions the wallet will sign and what each takes, the exit position as an NFT and who holds it, the surplus as
 * Meteora splits it and the creator's lock. Built from the same claim `…/claim/build` builds; nothing is kept and nothing
 * signed. Public data. Read while Launch is paused too — the claim itself then waits.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  /* It builds and simulates the claim as «Забрати» would: counted in a window of its own, shared by every instance. */
  const rate = await consumeSharedLaunchWrite("claimReview", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!BASE58.test(wallet)) return apiFailure("VALIDATION_ERROR", "wallet: not an address");
  const read = await readLaunchClaimReview(deps, mint, wallet).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now. Try again." }));
  if (!read.ok) return apiFailure(read.code, read.message);
  return apiJson(read.review satisfies LaunchClaimReviewResponse);
}
