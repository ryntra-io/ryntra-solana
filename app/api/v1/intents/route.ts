import { IntentCreateRequestSchema, type IntentCreatedResponse } from "@/lib/api/v1/contract";
import { apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { consumeIntentCreate, createInputOf, intentFailure, intentsOrRefusal } from "@/lib/intents/http.server";
import { createIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin } from "@/lib/intents/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/intents` (1.90.0, CITY-161) — an agent, a chat or a partner prepares a swap for a person to sign: the
 * coin, the raw amount, the side, a deadline, who prepared it and, if known, the wallet it is for. No wallet and no key:
 * the intent is a request, never an authority. The answer is the intent with Ryntra's own https link and a QR of it,
 * and the creator's key, shown once. The person opens the link in the city, sees the engine's live quote, and signs in
 * their own wallet; Ryntra never signs for them. A transfer to another address is closed in phase 1.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const served = intentsOrRefusal();
  if (!served.ok) return served.response;
  const window = consumeIntentCreate(request.headers);
  if (!window.ok) return window.response;
  const read = await readApiBody(request, IntentCreateRequestSchema, 2_048);
  if (!read.ok) return read.response;
  const made = await createIntent(served.deps, createInputOf(read.body));
  if (!made.ok) return intentFailure(made, window.headers);
  return apiJson({ intent: projectIntent(made.record, made.status, publicIntentOrigin()), creatorKey: made.creatorKey } satisfies IntentCreatedResponse, 201, window.headers);
}
