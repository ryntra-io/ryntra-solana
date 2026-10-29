import { BASE58, LaunchTradeSubmitRequestSchema, type LaunchTradeSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { serverTimingOf, type StepTiming } from "@/lib/core/pipeline";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";
import { submitLaunchTrade } from "@/lib/launch/trade.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/trade/submit` (contract 1.27.0) — the signed
 * trade: the built bytes, with nothing changed but the wallet's own fee and
 * guard instructions, and a valid signature. Sent once and confirmed;
 * `PENDING` when the network did not answer in time — never sent again.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("tradeSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTradeSubmitRequestSchema);
  if (!read.ok) return read.response;
  const started = performance.now();
  const timings: StepTiming[] = [];
  const sent = await submitLaunchTrade(deps, mint, read.body, timings).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was sent. Try again." }));
  /* SOL-P1: the send and the confirmation, each timed — names only. */
  const timing = serverTimingOf(timings, [{ name: "total", ms: performance.now() - started }]);
  if (!sent.ok) return apiFailure(sent.code, sent.message, { headers: { "server-timing": timing } });
  return apiJson(sent.submit satisfies LaunchTradeSubmitResponse, 200, { "server-timing": timing });
}
