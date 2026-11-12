import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Who is trying a vault. A person signed in with a wallet is their account; anyone else is a guest, known by a key in an
 * HttpOnly cookie that only the server can make:
 *
 *     rvg = v1.<guest id>.<tag>      tag = HMAC-SHA256(secret, "vault-guest:v1:" ‖ id)
 *
 * The key holds no progress and no limit — those stay on the server — so clearing the cookie gives a new guest and
 * nothing more; the limit per address still holds for them. The secret is the server's signing secret, with its own
 * prefix, so this key can stand in for no other.
 */

export const VAULT_GUEST_COOKIE = "rvg";
const MAX_AGE_S = 365 * 24 * 3600;
const PREFIX = "vault-guest:v1:";
const KEY = /^v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export type Who = { kind: "wallet" | "guest"; id: string };

/** The key of this request's person in the vault's books. */
export const whoKey = (who: Who) => `${who.kind === "wallet" ? "a" : "g"}:${who.id}`;

const tag = (id: string, secret: string) => createHmac("sha256", secret).update(`${PREFIX}${id}`).digest("base64url");

export function newGuest(secret: string): { id: string; cookie: string } {
  const id = randomBytes(16).toString("base64url");
  return { id, cookie: `v1.${id}.${tag(id, secret)}` };
}

/** The guest a cookie value names, if the server made it; null otherwise. */
export function guestOf(value: string | null, secret: string): string | null {
  if (!value || value.length > 80) return null;
  const match = KEY.exec(value);
  if (!match) return null;
  const given = Buffer.from(match[2]!, "utf8");
  const wanted = Buffer.from(tag(match[1]!, secret), "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? match[1]! : null;
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

/** The `Set-Cookie` line for the guest key: HttpOnly, this site only, `Secure` over TLS. */
export function guestCookieHeader(value: string, requestUrl: string): string {
  const parts = [`${VAULT_GUEST_COOKIE}=${value}`, "Path=/", `Max-Age=${MAX_AGE_S}`, "HttpOnly", "SameSite=Lax"];
  if (new URL(requestUrl).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

/** The `Set-Cookie` line that drops the guest key: its progress now lives on the wallet's account. */
export function forgetGuestHeader(requestUrl: string): string {
  const parts = [`${VAULT_GUEST_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (new URL(requestUrl).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

/**
 * The network an address limit counts: an IPv4 address as it is, an IPv6 address by its /64 — one household or one
 * phone gets a whole /64, so counting single IPv6 addresses would give one person billions of fresh limits. An IPv4
 * address written as IPv6 (`::ffff:1.2.3.4`) is the IPv4 address. Anything else is counted as it came.
 */
export function networkOf(address: string): string {
  const ip = address.trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  const halves = ip.split("::");
  if (halves.length > 2) return ip;
  const parts = (half: string | undefined) => (half ? half.split(":") : []);
  const head = parts(halves[0]);
  const tail = parts(halves[1]);
  const last = (halves.length === 2 ? tail : head).at(-1) ?? "";
  const v4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(last) ? last : null;
  // An IPv4 address at the end of an IPv6 one stands for its last two groups.
  const count = head.length + tail.length + (v4 ? 1 : 0);
  const zeros = halves.length === 2 ? 8 - count : 0;
  if (count + zeros !== 8 || (halves.length === 2 && zeros < 1)) return ip;
  const groups = [...head, ...Array.from({ length: zeros }, () => "0"), ...tail];
  if (v4) groups.pop();
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip;
  const n = groups.map((g) => parseInt(g, 16));
  if (v4 && n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return v4;
  return `${n.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** How a person shows in the public feed: a short tag that names nobody and is the same for them all day. */
export function feedTag(who: Who, day: string, secret: string): string {
  const code = createHash("sha256").update(`${secret}:vault-tag:${day}:${whoKey(who)}`).digest("hex").slice(0, 4).toUpperCase();
  return `${who.kind === "wallet" ? "Wallet" : "Guest"} ${code}`;
}
