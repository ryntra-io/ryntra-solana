import { BASE58, type LaunchHolderPositionsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readHolderPositions } from "@/lib/launch/holder.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/holders/{address}` (contract 1.33.0) — «Мої позиції»:
 * every position the wallet entered through Ryntra, across launches, each read
 * from the chain now — what it holds and is worth, the fees, its permission,
 * what Ryntra's collector brought — and the holder's earnings card data.
 */
export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("cabinet", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { address } = await context.params;
  if (!BASE58.test(address)) return apiFailure("VALIDATION_ERROR", "address: not a wallet");
  const read = await readHolderPositions(deps, address).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The positions could not be read now. Try again." }));
  if (!read.ok) return apiFailure(read.code, read.message);
  return apiJson(read.positions satisfies LaunchHolderPositionsResponse);
}
