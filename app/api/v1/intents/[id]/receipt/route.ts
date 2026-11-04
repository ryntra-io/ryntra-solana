import { IntentReceiptRequestSchema, type IntentResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeIntentStep, intentFailure, intentsOrRefusal, sameSiteOrRefusal } from "@/lib/intents/http.server";
import { receiptIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/intents/{id}/receipt` (1.90.0, CITY-161) — the claiming wallet's transaction signature ends the intent
 * for good. Where intents are open on mainnet the transaction must have landed, paid by that wallet; one signature
 * answers one intent.
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
  const read = await readApiBody(request, IntentReceiptRequestSchema, 1_024);
  if (!read.ok) return read.response;
  const done = await receiptIntent(served.deps, (await params).id, read.body);
  if (!done.ok) return intentFailure(done, window.headers);
  // The claiming wallet's own step: its receipt comes back to it.
  return apiJson({ intent: projectIntent(done.record, done.status, publicIntentOrigin(), { receipt: true, sent: true }) } satisfies IntentResponse, 200, window.headers);
}
