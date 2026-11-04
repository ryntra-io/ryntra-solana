import type { IntentResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { INTENT_KEY_HEADER, intentFailure, intentsOrRefusal } from "@/lib/intents/http.server";
import { readIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/intents/{id}` (1.90.0, CITY-161) — the intent and where it stands, for whoever holds the id (the city's
 * sheet). The receipt — the wallet and signature that ended it — only with the creator's key in `X-Ryntra-Intent-Key`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = intentsOrRefusal();
  if (!served.ok) return served.response;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readIntent(served.deps, (await params).id, request.headers.get(INTENT_KEY_HEADER));
  if (!read.ok) return intentFailure(read, rateLimitHeaders(rate));
  return apiJson({ intent: projectIntent(read.record, read.status, publicIntentOrigin(), { receipt: read.creator }) } satisfies IntentResponse, 200, rateLimitHeaders(rate));
}
