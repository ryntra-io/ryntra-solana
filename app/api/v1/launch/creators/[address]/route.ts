import { BASE58, type LaunchCreatorCabinetResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readCreatorCabinet } from "@/lib/launch/creator.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/v1/launch/creators/{address}` (contract 1.29.0) — «Мої лаунчі»:
 * the wallet's launches as their creator and those whose creator fees it
 * shares in, each read again from the chain — the way to the DEX and what the
 * creator's side earned by source, the wallet's part of it — its claim
 * receipts and the creator earnings card's data. Public data: launches and
 * their fees are on chain, the receipts are of public transactions.
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
  const cabinet = await readCreatorCabinet(deps, address).catch(() => null);
  if (!cabinet) return apiFailure("UNAVAILABLE", "The launches could not be read now. Try again.");
  return apiJson(cabinet satisfies LaunchCreatorCabinetResponse);
}
