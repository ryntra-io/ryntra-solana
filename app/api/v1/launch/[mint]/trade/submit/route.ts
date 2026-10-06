import { BASE58, LaunchTradeSubmitRequestSchema, type LaunchTradeSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { consumeLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";
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
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeLaunchWrite("tradeSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTradeSubmitRequestSchema);
  if (!read.ok) return read.response;
  const sent = await submitLaunchTrade(deps, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network could not be read now; nothing was sent. Try again." }));
  if (!sent.ok) return apiFailure(sent.code, sent.message);
  return apiJson(sent.submit satisfies LaunchTradeSubmitResponse);
}
