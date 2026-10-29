import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The guest's key: who a person is in the world before they sign in with a
 * wallet. It lives only in an HttpOnly cookie, so no script on the page can
 * read it.
 *
 *     rwg = v1.<resident id>.<tag>      tag = HMAC-SHA256(secret, "world-guest:v1:" ‖ id ‖ ":" ‖ salt)
 *
 * The salt is random, kept on the resident's row and never sent anywhere.
 * Three things follow. Nobody can make a key without the server's secret. A
 * leaked copy of the database alone makes no key either. And clearing the
 * salt — which joining an account does — ends every copy of the key at once,
 * while the same resident and salt always give the same key, so a retried
 * claim can hand back the very cookie the first answer set.
 *
 * The secret is the one the session tokens use, with its own prefix so the
 * two can never stand in for each other. Without it no guest is made.
 */

export const GUEST_COOKIE = "rwg";
/** A year: a guest's place should outlast a holiday. */
export const GUEST_COOKIE_MAX_AGE_S = 365 * 24 * 3600;

const PREFIX = "world-guest:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export function newGuestSalt(): string {
  return randomBytes(16).toString("hex");
}

function tag(residentId: string, salt: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}${residentId}:${salt}`).digest("base64url");
}

/** The cookie value for a guest, or null without a secret or a salt. */
export function guestKey(residentId: string, salt: string | null, secret: string | null): string | null {
  if (!secret || !salt || !UUID.test(residentId)) return null;
  return `v1.${residentId}.${tag(residentId, salt, secret)}`;
}

/** The resident a cookie value names, before any check. Null for anything malformed. */
export function guestResidentId(value: string | null | undefined): string | null {
  if (!value || value.length > 120) return null;
  const match = KEY.exec(value);
  return match && UUID.test(match[1]) ? match[1] : null;
}

/** Whether a cookie value is the key of this guest right now. */
export function guestKeyMatches(value: string, resident: Readonly<{ id: string; guestSalt: string | null; accountId: string | null }>, secret: string | null): boolean {
  if (resident.accountId !== null) return false;
  const expected = guestKey(resident.id, resident.guestSalt, secret);
  if (!expected) return false;
  const given = Buffer.from(value, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** A value from a `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/**
 * The `Set-Cookie` line for the guest key: HttpOnly, the whole site, sent on
 * top-level navigation but not on another site's requests (`Lax`), and
 * `Secure` whenever the site is served over TLS — the same rule as the
 * account's own session cookie. A null value clears it.
 */
export function guestCookieHeader(value: string | null, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const parts = [`${GUEST_COOKIE}=${value ?? ""}`, "Path=/", `Max-Age=${value ? GUEST_COOKIE_MAX_AGE_S : 0}`, "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** A request address as the database may keep it: keyed, so it cannot be read back. */
export function hashedAddress(ip: string, secret: string | null): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret).update(`world-ip:${ip}`).digest("hex").slice(0, 32);
}
