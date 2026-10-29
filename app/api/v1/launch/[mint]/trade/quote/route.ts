import { BASE58, LaunchTradeQuoteRequestSchema, type LaunchTradeQuoteResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { serverTimingOf, type StepTiming } from "@/lib/core/pipeline";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";
import { quoteLaunchTrade } from "@/lib/launch/trade.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/launch/{mint}/trade/quote` (contract 1.27.0) — what a buy or a
 * sale of a Ryntra launch gets now, on its curve or in its pool: the amount
 * out, the least it lands with, the fee and who receives it, how far it moves
 * the price. Builds and signs nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("tradeQuote", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTradeQuoteRequestSchema);
  if (!read.ok) return read.response;
  const started = performance.now();
  const timings: StepTiming[] = [];
  const quoted = await quoteLaunchTrade(deps, mint, read.body, timings).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was sent. Try again." }));
  /* SOL-P1: how long each read of the quote took, on a refusal too. */
  const timing = serverTimingOf(timings, [{ name: "total", ms: performance.now() - started }]);
  if (!quoted.ok) return apiFailure(quoted.code, quoted.message, { headers: { "server-timing": timing } });
  return apiJson(quoted.quote satisfies LaunchTradeQuoteResponse, 200, { "server-timing": timing });
}
