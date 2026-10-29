/**
 * The aggregator's webhooks, received: the signature checked, a stale or
 * replayed delivery refused, each delivery taken once, and the trade events
 * passed to the fee ledger.
 *
 * - **Secret.** Each webhook endpoint has its own signing secret (`whsec_…`),
 *   shown once when the endpoint is created in the aggregator's dashboard. It
 *   is not the app secret that signs external ids (`AGG_APP_SECRET`): the two
 *   are separate keys. The deployment reads it from `AGG_WEBHOOK_SECRET`.
 *   Without it the route answers *not configured* and accepts nothing.
 * - **Signature.** HMAC-SHA256 over `{Webhook-Id}.{Webhook-Timestamp}.{raw body}`
 *   with the base64 key after `whsec_`, sent as `v1,<base64>`; several
 *   space-separated signatures may arrive while a secret rotates, and any one
 *   matching is enough. Compared in constant time, over the bytes as sent.
 * - **Replay.** A timestamp more than five minutes from now is refused, and a
 *   `Webhook-Id` already taken is answered as received without a second
 *   effect. The ledger itself also keeps the event ids it applied, so even a
 *   delivery taken twice by two instances counts once.
 * - **Answer.** 2xx only after the event is durably recorded; a failure while
 *   applying it answers 5xx so the aggregator delivers it again.
 *
 * Server only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { storeSupportsConcurrentInstances, type GuardStore } from "../guard/store.ts";
import { applyLedgerEvent, isLedgerEvent, type AggWebhookEvent, type LedgerApplied } from "./fee-ledger.ts";

export const WEBHOOK_EVENTS_COLLECTION = "predictionWebhookEvents" as const;
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const WEBHOOK_MAX_BODY_BYTES = 262_144;

export type WebhookCheck = "ok" | "missing_headers" | "stale" | "invalid";

/** The webhook signing secret of this deployment, or null when none was given. */
export function readWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.AGG_WEBHOOK_SECRET?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function webhookKey(secret: string): Buffer {
  return Buffer.from(secret.replace(/^whsec_/, ""), "base64");
}

/** The `v1,<base64>` signature the aggregator would send for this delivery. */
export function signWebhook(secret: string, id: string, timestamp: string, body: string | Uint8Array): string {
  return `v1,${createHmac("sha256", webhookKey(secret)).update(`${id}.${timestamp}.`).update(body).digest("base64")}`;
}

export function checkWebhookSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string | Uint8Array;
  nowSeconds: number;
  toleranceSeconds?: number;
}): WebhookCheck {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return "missing_headers";
  if (!/^\d{1,12}$/.test(timestamp) || webhookKey(input.secret).length === 0) return "invalid";
  const expected = Buffer.from(signWebhook(input.secret, id, timestamp, input.body));
  const matched = signature
    .split(" ")
    .filter((candidate) => candidate.length > 0)
    .some((candidate) => {
      const given = Buffer.from(candidate);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  if (!matched) return "invalid";
  return Math.abs(input.nowSeconds - Number(timestamp)) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS) ? "stale" : "ok";
}

export type WebhookDelivery = Readonly<{
  messageId: string;
  eventId: string;
  type: string;
  createdAt: string | null;
  receivedAt: string;
  state: "received" | "applied";
  /** What the ledger did with it: a trade event it could not read stays visible here, with its data, to apply again later. */
  ledger: LedgerApplied | null;
  /** The trade events' own data (ids, statuses, amounts); other types keep none, so no email is stored. */
  data: Readonly<Record<string, unknown>> | null;
  /** A body that was not a JSON object, cut short, kept to read later; null otherwise. */
  raw: string | null;
  appliedAt: string | null;
}>;

export type WebhookOutcome = Readonly<{ duplicate: boolean; ledger: LedgerApplied }>;

/**
 * Take one verified delivery: claim its message id, apply it to the ledger,
 * mark it applied. A claim left at «received» (an instance that stopped
 * halfway) is applied again on the next delivery; the ledger's own event ids
 * keep that from counting twice.
 */
export async function receiveWebhook(store: GuardStore, messageId: string, event: AggWebhookEvent, receivedAt: string, raw: string | null = null): Promise<WebhookOutcome> {
  const deliveries = store.collection<WebhookDelivery>(WEBHOOK_EVENTS_COLLECTION);
  const trade = isLedgerEvent(event.type);
  const record: WebhookDelivery = { messageId, eventId: event.id, type: event.type, createdAt: event.createdAt, receivedAt, state: "received", ledger: null, data: trade ? event.data : null, raw, appliedAt: null };
  const claimed = await deliveries.insertIfAbsent(messageId, record);
  if (!claimed) {
    const existing = await deliveries.get(messageId);
    if (existing?.state === "applied") return { duplicate: true, ledger: existing.ledger ?? "ignored" };
  }
  const ledger = trade ? await applyLedgerEvent(store, event) : "ignored";
  await deliveries.set(messageId, { ...record, state: "applied", ledger, appliedAt: receivedAt });
  return { duplicate: !claimed, ledger };
}

/** The type a signed delivery is recorded under when its body is not an event the receiver can read. */
export const UNREADABLE_EVENT_TYPE = "unreadable";
const UNREADABLE_RAW_CHARS = 16_384;

/**
 * Read a signed delivery's envelope. The aggregator signed it, so nothing in
 * it is refused: a dashboard test, a type added later, an event with no `data`
 * or no `id` is taken as it came — the id falls back to the message id, the
 * data to nothing — and only the three trade types ever reach the ledger. A
 * body that is not a JSON object is kept, cut short, under its own type so it
 * can be read later; answering it with an error would only make the
 * aggregator send it again and again.
 */
export function parseEnvelope(body: string, messageId: string): AggWebhookEvent & { raw: string | null } {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const env = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!env) return { id: messageId, type: UNREADABLE_EVENT_TYPE, createdAt: null, data: {}, raw: body.slice(0, UNREADABLE_RAW_CHARS) };
  const id = typeof env.id === "string" && env.id.length > 0 && env.id.length <= 200 ? env.id : messageId;
  const type = typeof env.type === "string" && env.type.length > 0 && env.type.length <= 100 ? env.type : UNREADABLE_EVENT_TYPE;
  const data = env.data && typeof env.data === "object" && !Array.isArray(env.data) ? (env.data as Record<string, unknown>) : {};
  return { id, type, createdAt: typeof env.createdAt === "string" ? env.createdAt : null, data, raw: type === UNREADABLE_EVENT_TYPE ? body.slice(0, UNREADABLE_RAW_CHARS) : null };
}

export type WebhookDeps = Readonly<{
  secret: string | null;
  store: GuardStore;
  now?: () => number;
  noStore?: Record<string, string>;
}>;

function refuse(status: number, code: string, message: string, headers: Record<string, string>): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** The whole route, framework-free so the tests drive it with a plain `Request`. */
export async function handleAggWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const headers = deps.noStore ?? {};
  const now = deps.now ?? Date.now;
  if (!deps.secret) return refuse(503, "UNAVAILABLE", "Webhooks are not configured on this deployment.", headers);
  /* Taking each delivery once across instances needs a store whose claims hold across instances. */
  if (!storeSupportsConcurrentInstances(deps.store)) return refuse(503, "UNAVAILABLE", "Webhooks need a shared durable store on this deployment.", headers);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BODY_BYTES) return refuse(413, "VALIDATION_ERROR", "The delivery is too large.", headers);
  const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.byteLength > WEBHOOK_MAX_BODY_BYTES) return refuse(413, "VALIDATION_ERROR", "The delivery is too large.", headers);

  const messageId = request.headers.get("webhook-id");
  const check = checkWebhookSignature({
    secret: deps.secret,
    id: messageId,
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body: bytes,
    nowSeconds: Math.floor(now() / 1000),
  });
  if (check !== "ok") return refuse(401, "SIGNATURE_INVALID", check === "stale" ? "The delivery is outside the time window." : "The delivery is not signed by the provider.", headers);

  if (!messageId || messageId.length > 200) return refuse(400, "VALIDATION_ERROR", "The delivery has no usable message id.", headers);
  const { raw, ...event } = parseEnvelope(new TextDecoder().decode(bytes), messageId);

  try {
    const outcome = await receiveWebhook(deps.store, messageId, event, new Date(now()).toISOString(), raw);
    return Response.json({ received: true, duplicate: outcome.duplicate }, { status: 200, headers });
  } catch {
    return refuse(500, "UNAVAILABLE", "The delivery could not be recorded; send it again.", headers);
  }
}
