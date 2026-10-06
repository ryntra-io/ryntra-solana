import { BASE58, type LaunchWalletResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";
import { readLaunchWallet } from "@/lib/launch/trade.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/launch/{mint}/wallet/{address}` (contract 1.27.0) — what a
 * wallet holds of a launched token and of its pair currency, for the trade's
 * «Max» and its shares of a sale. Public data, read from the chain now.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string; address: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint, address } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  if (!BASE58.test(address)) return apiFailure("VALIDATION_ERROR", "address: not an address");
  const read = await readLaunchWallet(deps, mint, address).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was sent. Try again." }));
  if (!read.ok) return apiFailure(read.code, read.message);
  return apiJson(read.wallet satisfies LaunchWalletResponse);
}
