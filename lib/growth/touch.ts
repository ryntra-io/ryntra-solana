import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { normalizePostCode, utmFromKey } from "./touch-param.ts";

/**
 * The first touch — where a person came from, kept in their browser until a wallet appears (Ріст 7).
 *
 * ## What is kept, and where
 *
 * One signed cookie, `rgt`, thirty days: the channel (a post, a contest, a friend, a UTM link), its source (the
 * post code, the UTM triple; a friend is just «a friend» — who invited is the Rewards ledger's), the moment of the
 * first tagged visit, and which source and day were counted last. Nothing about the person: no address, no IP, no
 * device. A second, readable cookie `rgtp` says only «a touch waits for a wallet», so the product's shell asks the
 * server to bind it once — and nobody else's page sends a request at all.
 *
 * ## First touch, and what counts as a visit
 *
 * The first tagged visit is the touch for thirty days: a later link from another post does not take a wallet the
 * first one brought. Every tagged arrival is still a visit of its own source — once per source a day in a browser,
 * so a reload is not a second visit.
 *
 * ## Why signed
 *
 * The cookie names the moment of the touch, and the panel calls a wallet acquired by a source only when the wallet
 * first appeared after it. An unsigned moment could be backdated to take wallets that came on their own. The key
 * is derived from the deployment's own secret; without one, no touch is written and the panel says so.
 */

export const TOUCH_COOKIE = "rgt";
export const TOUCH_PENDING_COOKIE = "rgtp";
export const TOUCH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOUCH_MAX_AGE_MS = TOUCH_MAX_AGE_SECONDS * 1000;

export const TOUCH_CHANNELS = ["post", "contest", "friend", "utm"] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

export type TouchSource = Readonly<{ channel: TouchChannel; source: string }>;

export type Touch = Readonly<{
  channel: TouchChannel;
  /** The post code; the UTM key `x|social|weekly`; `friend` for a friend's link. */
  source: string;
  /** The first tagged visit, ms. */
  at: number;
  /** The source and UTC day counted last: `post:ABC…@2026-10-24`. */
  last: string;
  /** This touch's own random name: it binds one wallet, once (`bindTouchWallet`). */
  nonce: string;
}>;

/** A source's one key: `post:7KD2F9X`, `utm:x|social|weekly`, `friend`. */
export function sourceKey(touch: TouchSource): string {
  return touch.channel === "friend" ? "friend" : `${touch.channel}:${touch.source}`;
}

export function sourceFromKey(key: string): TouchSource | null {
  if (key === "friend") return { channel: "friend", source: "friend" };
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const channel = key.slice(0, colon);
  const source = key.slice(colon + 1);
  if ((channel === "post" || channel === "contest") && normalizePostCode(source) === source) return { channel, source };
  if (channel === "utm" && utmFromKey(source)) return { channel, source };
  return null;
}

/** The touch key, from the deployment's secret; null when there is none — then no touch is written. */
export function touchKeyFrom(env: Readonly<Record<string, string | undefined>>): Buffer | null {
  const secret = env.BETA_TOKEN_SECRET;
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret).update("ryntra-growth-touch-v1").digest();
}

function sign(payload: string, key: Uint8Array): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function encodeTouch(touch: Touch, key: Uint8Array): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, c: touch.channel, s: touch.source, at: touch.at, l: touch.last, n: touch.nonce })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** The touch a browser carries, when it is ours, readable and younger than thirty days; else null. */
export function decodeTouch(value: string | null | undefined, key: Uint8Array | null, nowMs: number): Touch | null {
  if (!key || typeof value !== "string" || value.length > 600) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload, key), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    if (raw.v !== 1 || typeof raw.c !== "string" || typeof raw.s !== "string" || typeof raw.at !== "number" || typeof raw.l !== "string") return null;
    if (typeof raw.n !== "string" || !TOUCH_NONCE.test(raw.n)) return null;
    const source = sourceFromKey(raw.c === "friend" ? "friend" : `${raw.c}:${raw.s}`);
    if (!source || !Number.isSafeInteger(raw.at) || raw.at > nowMs + 60_000 || nowMs - raw.at > TOUCH_MAX_AGE_MS) return null;
    return { channel: source.channel, source: source.source, at: raw.at, last: raw.l.slice(0, 120), nonce: raw.n };
  } catch {
    return null;
  }
}

export const TOUCH_NONCE = /^[A-Za-z0-9_-]{16}$/;

export function newTouchNonce(): string {
  return randomBytes(12).toString("base64url");
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type VisitDecision = Readonly<{
  /** Count this arrival as a visit of its source. */
  count: boolean;
  /** The touch to keep in the browser. */
  touch: Touch;
  /** Whether this arrival became the first touch (the browser carried none). */
  first: boolean;
}>;

/**
 * One tagged arrival: the first touch stays for thirty days; the arrival is a visit of its own source unless the
 * same source was already counted in this browser today.
 */
export function decideVisit(carried: Touch | null, arrived: TouchSource, nowMs: number, nonce: () => string = newTouchNonce): VisitDecision {
  const mark = `${sourceKey(arrived)}@${utcDay(nowMs)}`;
  if (carried) return { count: carried.last !== mark, touch: { ...carried, last: mark }, first: false };
  return { count: true, touch: { channel: arrived.channel, source: arrived.source, at: nowMs, last: mark, nonce: nonce() }, first: true };
}
