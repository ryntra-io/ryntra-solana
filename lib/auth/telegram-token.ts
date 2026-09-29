import { createHash } from "node:crypto";

/**
 * Telegram's ID token, read after Supabase has verified it.
 *
 * Telegram Login hands the browser an OpenID Connect ID token. The product
 * passes that exact token to Supabase (`signInWithIdToken`, provider
 * `custom:telegram`), and Supabase — not this module — checks its signature
 * against Telegram's JWKS, the issuer, the audience, the expiry and the nonce.
 * What Supabase keeps afterwards is the standard claim set; Telegram's numeric
 * user id lives in the non-standard `id` claim and is dropped on the way.
 *
 * So the product reads `id` itself, from the same token string Supabase just
 * accepted. Nothing here verifies anything: `readTelegramIdToken` is a decoder
 * and must only be trusted for a token Supabase has already turned into a
 * session in the same request.
 *
 * Nonce: Supabase compares `sha256(nonce it is given)` with the token's `nonce`
 * claim, and Telegram writes the nonce it is given into the token verbatim. The
 * round trip therefore hands Telegram `telegramNonceFor(raw)` and Supabase
 * `raw`, and the two meet in the middle.
 */

export const TELEGRAM_ISSUER = "https://oauth.telegram.org";

export type TelegramIdTokenClaims = Readonly<{
  issuer: string | null;
  subject: string | null;
  /** Telegram's numeric user id (`id`, profile scope), or `null` when absent or malformed. */
  telegramId: number | null;
  nonce: string | null;
  name: string | null;
  username: string | null;
  expiresAt: number | null;
}>;

/** The value Telegram is asked to write into the token for a given raw nonce. */
export function telegramNonceFor(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numericId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Decode the payload of a JWS compact token. No verification — see the module note. */
export function readTelegramIdToken(token: unknown): TelegramIdTokenClaims | null {
  if (typeof token !== "string" || token.length < 20 || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const claims = payload as Record<string, unknown>;
  return {
    issuer: str(claims.iss),
    subject: str(claims.sub),
    telegramId: numericId(claims.id),
    nonce: str(claims.nonce),
    name: str(claims.name) ?? str(claims.given_name),
    username: str(claims.preferred_username),
    expiresAt: typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.exp : null,
  };
}

/**
 * Does the token Supabase accepted belong to the round trip this browser
 * started? Supabase already compared the nonce; this repeats the comparison
 * against the product's own record so a mismatch between the two layers can
 * never pass silently, and it pins the issuer the product expects.
 */
export function telegramTokenMatches(claims: TelegramIdTokenClaims, rawNonce: string): boolean {
  return claims.issuer === TELEGRAM_ISSUER && claims.nonce !== null && claims.nonce === telegramNonceFor(rawNonce);
}
