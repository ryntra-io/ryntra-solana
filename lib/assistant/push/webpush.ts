/**
 * Push to a computer's browser (AI-19) — Web Push with VAPID, no payload.
 *
 * The browser subscribes once (`/api/v1/assistant/push/subscribe`); a note
 * that goes to push wakes every subscription of the wallet with an empty
 * message signed by the deployment's VAPID key, and the page's service worker
 * (`public/ryntra-push-sw.js`) reads the wallet's latest note from Ryntra
 * itself and shows it. An empty message needs no encryption, carries no
 * words through the push service, and a stolen endpoint shows nothing.
 *
 * The key is one environment variable, `RYNTRA_WEBPUSH_JWK` — a P-256 private
 * JWK, set by the operator's script (`scripts/assistant/webpush-keys.mjs`), never
 * printed. Without it nothing is sent and nothing is wrong: the inbox and
 * Telegram still carry every note.
 */

import { createHash, createPrivateKey, sign } from "node:crypto";

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";

export const WEBPUSH_ENV = "RYNTRA_WEBPUSH_JWK";
export const WEBPUSH_COLLECTION = "assistantWatches" as const;
const PREFIX = "webpush:solana:mainnet:";
/** A wallet keeps a subscription per browser; ten covers a person's computers and browsers. */
export const WEBPUSH_PER_WALLET = 10;

const Jwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().min(40), y: z.string().min(40), d: z.string().min(40) }).passthrough();

/** The deployment's VAPID key, or null when it is not set (or not a P-256 private JWK). */
export function vapidKey(env: Readonly<Record<string, string | undefined>> = process.env): Readonly<{ jwk: z.infer<typeof Jwk>; publicKey: string }> | null {
  const raw = env[WEBPUSH_ENV]?.trim();
  if (!raw) return null;
  try {
    const jwk = Jwk.parse(JSON.parse(raw));
    const x = Buffer.from(jwk.x, "base64url");
    const y = Buffer.from(jwk.y, "base64url");
    if (x.length !== 32 || y.length !== 32) return null;
    /* The application server key a browser subscribes with: the uncompressed point, base64url. */
    return { jwk, publicKey: Buffer.concat([Buffer.from([4]), x, y]).toString("base64url") };
  } catch {
    return null;
  }
}

/** `Authorization: vapid t=<jwt>, k=<key>` for one push service's origin (RFC 8292), signed ES256. */
export function vapidAuthorization(endpoint: string, key: NonNullable<ReturnType<typeof vapidKey>>, nowMs: number, subject = "https://ryntra.io"): string {
  const audience = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: createPrivateKey({ key: key.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${unsigned}.${signature}, k=${key.publicKey}`;
}

/** Only the push services browsers use: an endpoint elsewhere is not a browser's, and the server never posts there. */
const PUSH_HOSTS = /^(?:fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)$/i;

export function pushEndpointAllowed(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.port === "" && url.username === "" && PUSH_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

export type WebPushSend = "sent" | "gone" | "failed" | "skipped_no_key";

/** Wake one subscription; `gone` — the browser unsubscribed, the subscription is to be dropped. */
export async function sendWebPushTickle(endpoint: string, nowMs: number, deps: Readonly<{ env?: Readonly<Record<string, string | undefined>>; post?: typeof fetch }> = {}): Promise<WebPushSend> {
  const key = vapidKey(deps.env);
  if (!key) return "skipped_no_key";
  if (!pushEndpointAllowed(endpoint)) return "gone";
  try {
    const response = await (deps.post ?? fetch)(endpoint, {
      method: "POST",
      headers: { authorization: vapidAuthorization(endpoint, key, nowMs), ttl: "900", urgency: "high", "content-length": "0" },
      signal: AbortSignal.timeout(5_000),
    });
    /* 403 stays `failed`: it is also a bad token on our side, and one pass must never drop every browser. A key since
       replaced is cleaned by the browser itself — the page sees the old key and subscribes anew. */
    if (response.status === 404 || response.status === 410) return "gone";
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/* ------------------------------------------------------------ subscriptions */

export const WebPushSubscriptionSchema = z
  .object({
    schema: z.literal("ryntra.assistant.webpush"),
    version: z.number().int().min(1),
    owner: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    endpoint: z.string().url().max(1_000),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

const subscriptionKey = (owner: string, endpoint: string) => `${PREFIX}${owner}:${createHash("sha256").update(endpoint).digest("hex").slice(0, 24)}`;
type Versioned = { version: number };
const rows = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(WEBPUSH_COLLECTION);

export async function listWebPush(store: GuardStore, owner: string): Promise<readonly WebPushSubscription[]> {
  return (await rows(store).valuesWithPrefix(`${PREFIX}${owner}:`)).flatMap((row) => {
    const parsed = WebPushSubscriptionSchema.safeParse(row);
    return parsed.success && parsed.data.owner === owner ? [parsed.data] : [];
  });
}

/** A browser receives one wallet's notes: subscribed under another wallet, it is that wallet's no longer (a shared computer). */
async function dropElsewhere(store: GuardStore, owner: string, endpoint: string): Promise<void> {
  for (const row of await rows(store).valuesWithPrefix(PREFIX)) {
    const parsed = WebPushSubscriptionSchema.safeParse(row);
    if (parsed.success && parsed.data.owner !== owner && parsed.data.endpoint === endpoint) await rows(store).delete(subscriptionKey(parsed.data.owner, endpoint));
  }
}

export async function addWebPush(store: GuardStore, owner: string, endpoint: string, nowMs: number): Promise<"added" | "kept" | "limit" | "refused"> {
  if (!pushEndpointAllowed(endpoint)) return "refused";
  await dropElsewhere(store, owner, endpoint);
  const key = subscriptionKey(owner, endpoint);
  if (await rows(store).get(key)) return "kept";
  if ((await listWebPush(store, owner)).length >= WEBPUSH_PER_WALLET) return "limit";
  const row: WebPushSubscription = { schema: "ryntra.assistant.webpush", version: 1, owner, endpoint, createdAt: new Date(nowMs).toISOString() };
  return (await rows(store).compareAndSet(key, null, row)) ? "added" : "kept";
}

export async function removeWebPush(store: GuardStore, owner: string, endpoint: string): Promise<void> {
  await rows(store).delete(subscriptionKey(owner, endpoint));
}

/** Wake every browser of the wallet at once; drop the ones that are gone. The count of browsers woken. */
export async function wakeBrowsers(store: GuardStore, owner: string, nowMs: number, deps: Parameters<typeof sendWebPushTickle>[2] = {}): Promise<Readonly<{ sent: number; subscriptions: number }>> {
  const subscriptions = await listWebPush(store, owner);
  const outcomes = await Promise.all(subscriptions.map((subscription) => sendWebPushTickle(subscription.endpoint, nowMs, deps)));
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome === "gone") await removeWebPush(store, owner, subscriptions[index].endpoint).catch(() => undefined);
  }
  return { sent: outcomes.filter((outcome) => outcome === "sent").length, subscriptions: subscriptions.length };
}
