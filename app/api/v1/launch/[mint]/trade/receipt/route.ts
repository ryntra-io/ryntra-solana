import { BASE58, LaunchTradeReceiptRequestSchema, type LaunchTradeReceiptResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { readLaunchTradeReceipt } from "@/lib/launch/record.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/launch/{mint}/trade/receipt` (contract 1.34.0) — a trade's
 * issuer-signed Outcome Receipt, by the wallet that sent it and its signature;
 * a trade still in flight is settled from the chain first. Public chain facts,
 * like a swap's receipt: nothing here sends.
 */
export async function POST(request: Request, context: { params: Promise<{ mint: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!launchNetwork()) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const deps = launchMarketDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  const read = await readApiBody(request, LaunchTradeReceiptRequestSchema);
  if (!read.ok) return read.response;
  const found = await readLaunchTradeReceipt(deps, mint, read.body).catch(() => undefined);
  if (found === undefined) return apiFailure("UNAVAILABLE", "The trade could not be read now. Try again.");
  if (found === null) return apiFailure("LAUNCH_NOT_FOUND", "No trade of this token with this signature was sent here by this wallet.");
  return apiJson({ signature: found.signature, state: found.state, receipt: found.receipt } satisfies LaunchTradeReceiptResponse);
}
