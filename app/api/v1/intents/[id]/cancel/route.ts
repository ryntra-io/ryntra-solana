import type { IntentResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { INTENT_KEY_HEADER, consumeIntentStep, intentFailure, intentsOrRefusal } from "@/lib/intents/http.server";
import { cancelIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/intents/{id}/cancel` (1.90.0, CITY-161) — its creator withdraws the intent while nobody holds it, with
 * the key it was given once (`X-Ryntra-Intent-Key`). The link then says so and never opens a sheet again; a claim in
 * progress is not interrupted (`INTENT_BUSY`).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = intentsOrRefusal();
  if (!served.ok) return served.response;
  const window = consumeIntentStep(request.headers);
  if (!window.ok) return window.response;
  const done = await cancelIntent(served.deps, (await params).id, request.headers.get(INTENT_KEY_HEADER));
  if (!done.ok) return intentFailure(done, window.headers);
  return apiJson({ intent: projectIntent(done.record, done.status, publicIntentOrigin(), { receipt: true }) } satisfies IntentResponse, 200, window.headers);
}
