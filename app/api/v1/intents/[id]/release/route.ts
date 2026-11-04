import { IntentStepRequestSchema, type IntentResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeIntentStep, intentFailure, intentsOrRefusal, sameSiteOrRefusal } from "@/lib/intents/http.server";
import { releaseIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/intents/{id}/release` (1.90.0, CITY-161) — the wallet said no, or the engine refused before anything was
 * signed: the claiming wallet lets the intent go, and it is open again for the rest of its time.
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
  const read = await readApiBody(request, IntentStepRequestSchema, 1_024);
  if (!read.ok) return read.response;
  const done = await releaseIntent(served.deps, (await params).id, read.body);
  if (!done.ok) return intentFailure(done, window.headers);
  return apiJson({ intent: projectIntent(done.record, done.status, publicIntentOrigin(), { sent: true }) } satisfies IntentResponse, 200, window.headers);
}
