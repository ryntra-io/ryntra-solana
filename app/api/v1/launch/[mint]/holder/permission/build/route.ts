import { BASE58, LaunchHolderPermissionBuildRequestSchema, type LaunchHolderPermissionBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { buildHolderPermission } from "@/lib/launch/holder.server";
import { provenWalletOf } from "@/lib/launch/holder-proof.server";
import { consumeSharedLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/holder/permission/build` (contract 1.33.0) —
 * «Увімкнути» (the SPL Approve of 0 and Ryntra's two bits) or «Відкликати» (the
 * bitmask to 0 and the SPL delegate revoked) for the owner to sign. «Відкликати»
 * is built whenever the wallet holds the position, the lane paused or not.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = await consumeSharedLaunchWrite("holderBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchHolderPermissionBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await buildHolderPermission({ ...deps, proven: provenWalletOf(request) }, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The position could not be read now; nothing was built. Try again." }));
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson(built.build satisfies LaunchHolderPermissionBuildResponse);
}
