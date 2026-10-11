import { BASE58, type LaunchHolderResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchHolder } from "@/lib/launch/holder.server";
import { provenWalletOf } from "@/lib/launch/holder-proof.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/{mint}/holder/{address}` (contract 1.33.0) — a
 * graduated launch's pool for a holder: whether the entry is built for this
 * wallet, Ryntra's collector and the two bits it asks for, Ryntra's share at
 * entry, and the wallet's positions entered through Ryntra, each read from the
 * chain now. Public chain facts; `open` false — a page draws nothing of the entry.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string; address: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("cabinet", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint, address } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  if (!BASE58.test(address)) return apiFailure("VALIDATION_ERROR", "address: not a wallet");
  const read = await readLaunchHolder({ ...deps, proven: provenWalletOf(request) }, mint, address).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The pool could not be read now. Try again." }));
  if (!read.ok) return apiFailure(read.code, read.message);
  return apiJson(read.holder satisfies LaunchHolderResponse);
}
