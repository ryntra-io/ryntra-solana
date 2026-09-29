import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The signed cookie that carries an identity round-trip's own state.
 *
 * When a person leaves for Google or Telegram, the product remembers where to
 * bring them back, which door they chose and when they left. That memory has
 * to survive the round trip and has to be unforgeable, or the callback would
 * take its instructions from whoever crafted the returning URL. It is a short
 * HMAC-signed value under `BETA_TOKEN_SECRET`, bound to a random nonce that
 * the callback compares against the `state` the provider echoes back, and it
 * expires on its own after ten minutes.
 *
 * Nothing secret travels in it: a path, a method name, a purpose and a nonce.
 */
export const ROUND_TRIP_COOKIE = "ry_auth_rt";
const TTL_MS = 10 * 60 * 1000;

export type RoundTripPurpose = "signin" | "link" | "admin";

export type RoundTrip = Readonly<{
  nonce: string;
  method: "google" | "telegram" | "email";
  purpose: RoundTripPurpose;
  next: string;
  /** Bind the new identity to the account the browser already holds (legacy bot session). */
  attach?: boolean;
  issuedAt: number;
}>;

function secret(): string | null {
  const value = process.env.BETA_TOKEN_SECRET;
  return value && value.length >= 16 ? value : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueRoundTrip(input: Omit<RoundTrip, "nonce" | "issuedAt">, now = Date.now()): { value: string; trip: RoundTrip } | null {
  const key = secret();
  if (!key) return null;
  const trip: RoundTrip = { ...input, attach: input.attach === true, nonce: randomBytes(18).toString("base64url"), issuedAt: now };
  const payload = Buffer.from(JSON.stringify(trip)).toString("base64url");
  return { value: `${payload}.${sign(payload, key)}`, trip };
}

export function readRoundTrip(value: string | null | undefined, now = Date.now()): RoundTrip | null {
  const key = secret();
  if (!key || typeof value !== "string" || value.length > 2048) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload, key), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<RoundTrip>;
    if (
      typeof parsed.nonce !== "string" ||
      (parsed.method !== "google" && parsed.method !== "telegram" && parsed.method !== "email") ||
      (parsed.purpose !== "signin" && parsed.purpose !== "link" && parsed.purpose !== "admin") ||
      typeof parsed.next !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    if (parsed.issuedAt > now + 60_000 || now - parsed.issuedAt > TTL_MS) return null;
    return { nonce: parsed.nonce, method: parsed.method, purpose: parsed.purpose, next: parsed.next, attach: parsed.attach === true, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}

export const ROUND_TRIP_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(TTL_MS / 1000),
};
