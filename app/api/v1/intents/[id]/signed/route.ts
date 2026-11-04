import { IntentMarkRequestSchema, type IntentResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeIntentStep, intentFailure, intentsOrRefusal, sameSiteOrRefusal } from "@/lib/intents/http.server";
import { markIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/intents/{id}/signed` (1.90.0, CITY-161) — the claiming wallet's signed bytes, handed over by the city
 * before the swap engine may send them. The server checks that this wallet pays for them and signed them, keeps only the
 * signature as the claim's mark and sends nothing; from then on the claim is never let go, and the same wallet pressing
 * again is told to read that signature back. Only the city at Ryntra's own origin takes this step.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = intentsOrRefusal();
  if (!served.ok) return served.response;
  const foreign = sameSiteOrRefusal(request);
  if (foreign) return foreign;
  const window = consumeIntentStep(request.headers);
  if (!window.ok) return window.response;
  const read = await readApiBody(request, IntentMarkRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const done = await markIntent(served.deps, (await params).id, read.body);
  if (!done.ok) return intentFailure(done, window.headers);
  return apiJson({ intent: projectIntent(done.record, done.status, publicIntentOrigin(), { sent: true }) } satisfies IntentResponse, 200, window.headers);
}
