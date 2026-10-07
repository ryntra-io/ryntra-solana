import { BASE58, LaunchHolderQuoteRequestSchema, type LaunchHolderQuoteResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { quoteLaunchHolder } from "@/lib/launch/holder.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/holder/quote` (contract 1.33.0) — what one coin
 * into the token's pool comes to now: Ryntra's share at entry, the part Zap
 * swaps, what the position holds after it and its share of the pool. Built only
 * where the entry is open to the wallet.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("holderQuote", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchHolderQuoteRequestSchema);
  if (!read.ok) return read.response;
  const quoted = await quoteLaunchHolder(deps, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The pool could not be read now. Try again." }));
  if (!quoted.ok) return apiFailure(quoted.code, quoted.message);
  return apiJson(quoted.quote satisfies LaunchHolderQuoteResponse);
}
