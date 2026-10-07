import { BASE58, LaunchHolderSubmitRequestSchema, type LaunchHolderSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { submitLaunchHolder } from "@/lib/launch/holder.server";
import { consumeSharedLaunchWrite, launchTradingDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/holder/submit` (contract 1.33.0) — the signed
 * entry: the bytes must be the built ones (the wallet may add only its own fee
 * and guard instructions), every signature valid; sent once. The position is
 * written down before the send, so a lost answer still finds it.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchTradingDeps();
  if (!deps) return apiFailure("LAUNCH_PAUSED", "Launch is paused; nothing was sent.");
  const rate = await consumeSharedLaunchWrite("holderSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchHolderSubmitRequestSchema);
  if (!read.ok) return read.response;
  const sent = await submitLaunchHolder(deps, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network did not answer; read the position again before entering again." }));
  if (!sent.ok) return apiFailure(sent.code, sent.message);
  return apiJson(sent.submit satisfies LaunchHolderSubmitResponse);
}
