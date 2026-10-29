/**
 * Signing a webhook delivery, and refusing a replayed one (DEV-2; spec §11.6, §11.8).
 *
 * A delivery carries three headers and is signed over the three things that make it this delivery and no other: its
 * own id, the second it was made, and the exact bytes of its body.
 *
 *     Ryntra-Webhook-Id:        5f1c…            32 hex, unique to this delivery
 *     Ryntra-Webhook-Timestamp: 1792022400       seconds
 *     Ryntra-Webhook-Signature: v1,<base64>      one per secret that signed it
 *
 *     signed = `${id}.${timestamp}.${body}`      HMAC-SHA256, the endpoint's secret
 *
 * A receiver that checks only the signature is not protected from a replay: the same bytes signed with the same
 * secret verify for ever, so anyone who can see one delivery can send it again. `verifyWebhook` therefore refuses on
 * two further grounds — a timestamp outside the window, and an id the receiver has already seen inside it. The
 * `seen` callback is both the question and the record: it is asked once, after the signature has been checked, and
 * answers whether this id was already taken (so a forged id can never fill the store).
 *
 * The signature header may carry several `v1,…` values: during a rotation both the old secret and the new one sign,
 * and a receiver that holds either accepts. Comparison is constant-time on both sides.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBHOOK_ID_HEADER = "Ryntra-Webhook-Id";
export const WEBHOOK_TIMESTAMP_HEADER = "Ryntra-Webhook-Timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "Ryntra-Webhook-Signature";
export const WEBHOOK_SIGNATURE_VERSION = "v1";

export const newDeliveryId = (): string => randomBytes(16).toString("hex");

/** A webhook secret as the endpoint's owner sees it, once. */
export const newWebhookSecret = (): string => `whsec_${randomBytes(32).toString("base64url")}`;

export function signWebhook(input: Readonly<{ id: string; timestamp: number; body: string; secrets: readonly string[] }>): Readonly<Record<string, string>> {
  const payload = `${input.id}.${input.timestamp}.${input.body}`;
  const signatures = input.secrets.map((secret) => `${WEBHOOK_SIGNATURE_VERSION},${createHmac("sha256", secret).update(payload).digest("base64")}`);
  return {
    [WEBHOOK_ID_HEADER]: input.id,
    [WEBHOOK_TIMESTAMP_HEADER]: String(input.timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: signatures.join(" "),
  };
}

export const WEBHOOK_REFUSALS = ["MALFORMED", "TIMESTAMP_OUTSIDE_WINDOW", "SIGNATURE_INVALID", "REPLAYED"] as const;
export type WebhookRefusal = (typeof WEBHOOK_REFUSALS)[number];

export type WebhookVerification = Readonly<{ ok: true; id: string; timestamp: number }> | Readonly<{ ok: false; refusal: WebhookRefusal }>;

/** One header, whatever shape the reader hands it in. */
function headerOf(headers: Headers | Readonly<Record<string, string | undefined>>, name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | undefined>)) if (key.toLowerCase() === lower && value !== undefined) return value;
  return null;
}

function matches(payload: string, secret: string, offered: readonly string[]): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("base64"));
  let found = false;
  /* Every candidate is compared, and the answer is folded in rather than returned: the time this takes says nothing
     about which one matched or how far it got. */
  for (const candidate of offered) {
    const given = Buffer.from(candidate);
    if (given.length === expected.length && timingSafeEqual(given, expected)) found = true;
  }
  return found;
}

export type WebhookVerifyInput = Readonly<{
  body: string;
  headers: Headers | Readonly<Record<string, string | undefined>>;
  /** The secrets a receiver holds: more than one only while a rotation is in flight. */
  secrets: readonly string[];
  now: Date;
  windowSeconds: number;
  /** Takes the delivery's id; answers true when it is new and records it, false when it has been seen. */
  seen: (id: string) => boolean | Promise<boolean>;
}>;

/**
 * Whether a delivery is this receiver's, now, and has not arrived before. The order matters: an id is only ever
 * recorded after the signature and the window have passed, so nobody fills a receiver's replay store with ids it
 * never signed.
 */
export async function verifyWebhook(input: WebhookVerifyInput): Promise<WebhookVerification> {
  const id = headerOf(input.headers, WEBHOOK_ID_HEADER);
  const stamp = headerOf(input.headers, WEBHOOK_TIMESTAMP_HEADER);
  const signature = headerOf(input.headers, WEBHOOK_SIGNATURE_HEADER);
  if (!id || !stamp || !signature || !/^[0-9a-f]{32}$/.test(id)) return { ok: false, refusal: "MALFORMED" };
  const timestamp = Number(stamp);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return { ok: false, refusal: "MALFORMED" };

  const offered = signature
    .split(/\s+/)
    .filter((part) => part.startsWith(`${WEBHOOK_SIGNATURE_VERSION},`))
    .map((part) => part.slice(WEBHOOK_SIGNATURE_VERSION.length + 1));
  if (offered.length === 0) return { ok: false, refusal: "MALFORMED" };

  const payload = `${id}.${timestamp}.${input.body}`;
  if (!input.secrets.some((secret) => matches(payload, secret, offered))) return { ok: false, refusal: "SIGNATURE_INVALID" };

  /* The window is checked after the signature so an unsigned request learns nothing about the receiver's clock. */
  const drift = Math.abs(Math.floor(input.now.getTime() / 1000) - timestamp);
  if (drift > input.windowSeconds) return { ok: false, refusal: "TIMESTAMP_OUTSIDE_WINDOW" };

  if (!(await input.seen(id))) return { ok: false, refusal: "REPLAYED" };
  return { ok: true, id, timestamp };
}
