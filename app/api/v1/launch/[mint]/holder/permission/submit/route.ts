import { BASE58, LaunchHolderPermissionSubmitRequestSchema, type LaunchHolderPermissionSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { submitHolderPermission } from "@/lib/launch/holder.server";
import { consumeSharedLaunchWrite, launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/holder/permission/submit` (contract 1.33.0) — the
 * signed «Увімкнути» or «Відкликати»: the built bytes, sent once. A revoke is
 * the owner's whenever they ask, so it is sent while Launch is paused too.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = await consumeSharedLaunchWrite("holderSubmit", request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchHolderPermissionSubmitRequestSchema);
  if (!read.ok) return read.response;
  const sent = await submitHolderPermission(deps, mint, read.body).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The network did not answer; read the position again." }));
  if (!sent.ok) return apiFailure(sent.code, sent.message);
  return apiJson(sent.submit satisfies LaunchHolderPermissionSubmitResponse);
}
