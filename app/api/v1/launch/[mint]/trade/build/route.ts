import { BASE58, LaunchTradeBuildRequestSchema, type LaunchTradeBuildResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";
import { buildLaunchTrade } from "@/lib/launch/trade.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/trade/build` (contract 1.27.0) — a buy or a sale
 * for the wallet to sign: Meteora DBC's own swap on the curve, or the DAMM v2
 * swap after graduation, the fee inside it, the wallet the fee payer and the
 * only signer. The wallet must hold what it spends. The server keeps the bytes
 * to compare the signed ones with, and signs nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("tradeBuild", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTradeBuildRequestSchema);
  if (!read.ok) return read.response;
  const built = await buildLaunchTrade(deps, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was sent. Try again." }));
  if (!built.ok) return apiFailure(built.code, built.message);
  return apiJson(built.build satisfies LaunchTradeBuildResponse);
}
