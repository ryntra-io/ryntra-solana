import { AssistantPushSubscriptionRequestSchema, type AssistantPushState } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { addWebPush, listWebPush, removeWebPush, vapidKey } from "@/lib/assistant/push/webpush";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" } as const;
const limiter = new FixedWindowLimiter({ limit: 10, windowMs: 60_000, maxKeys: 5_000 });
const UNAVAILABLE = "Push needs a durable store; this deployment does not have one.";

/** The endpoint a browser names travels in a header or the body, never in a URL. */
const ENDPOINT_HEADER = "x-ryntra-push-endpoint";

async function state(owner: string, endpoint: string | null): Promise<AssistantPushState> {
  const key = vapidKey();
  const browsers = await listWebPush(getGuardRuntime().store, owner).catch(() => []);
  return { configured: key !== null, publicKey: key?.publicKey ?? null, browsers: browsers.length, thisBrowser: endpoint ? browsers.some((row) => row.endpoint === endpoint) : null };
}

/** `GET /api/v1/assistant/push` (contract 1.59.0) — whether this deployment pushes to a browser, its public key, and how many of the wallet's browsers receive it. */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const asked = request.headers.get(ENDPOINT_HEADER);
  return apiJson((await state(proof.address, asked && asked.length <= 1_000 ? asked : null)) satisfies AssistantPushState, 200, NO_STORE);
}

/** `POST /api/v1/assistant/push` — this browser receives the wallet's notes; the endpoint must be a browser's push service. */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantPushSubscriptionRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many changes in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  if (!vapidKey()) return apiFailure("CAPABILITY_UNAVAILABLE", "Push to a browser is not switched on for this deployment.");
  const added = await addWebPush(guard.store, proof.address, read.body.endpoint, Date.now());
  if (added === "refused") return apiFailure("VALIDATION_ERROR", "That is not a browser's push service.");
  if (added === "limit") return apiFailure("RATE_LIMITED", "This wallet already pushes to ten browsers; turn one off first.");
  return apiJson((await state(proof.address, read.body.endpoint)) satisfies AssistantPushState, 200, { ...rateLimitHeaders(rate), ...NO_STORE });
}

/** `DELETE /api/v1/assistant/push` — this browser stops receiving the wallet's notes. */
export async function DELETE(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantPushSubscriptionRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  await removeWebPush(guard.store, proof.address, read.body.endpoint);
  return apiJson((await state(proof.address, read.body.endpoint)) satisfies AssistantPushState, 200, NO_STORE);
}
