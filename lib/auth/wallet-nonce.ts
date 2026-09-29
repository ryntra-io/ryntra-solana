import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Self-authenticating login nonces.
 *
 * This module exists to close a hole that single-use alone does not.
 *
 * The obvious design reuses `beta_consume_login_nonce`, which is already
 * applied in production and gives exactly-once semantics with an expiry. But
 * that function records *consumption*, not *issuance*: it accepts any
 * well-formed 24-character string and returns true the first time it sees one.
 * An attacker who invents their own nonce, builds a message around it and signs
 * it would sail through — first use, therefore accepted — and the nonce would
 * have protected nothing at all. Single-use is not the same property as
 * server-issued, and a login needs both.
 *
 * So the nonce carries its own proof of issuance. Twelve random characters, and
 * twelve derived from an HMAC of them under the application secret:
 *
 *     nonce = r(12) ‖ tag(12)      tag = base62(HMAC-SHA256(secret, "siwe:" ‖ r))
 *
 * The server can then answer "did I mint this?" with no stored state, and the
 * database still answers "has it been spent?". Neither question is sufficient
 * on its own and neither is skipped.
 *
 * Two constraints decide the alphabet and the length, and both are hard:
 * EIP-4361 requires the nonce to be alphanumeric, and
 * `beta_consume_login_nonce` requires `^[A-Za-z0-9_-]{24}$`. Twenty-four
 * base62 characters is the intersection, so the same string satisfies the
 * standard and the stored procedure without translation.
 *
 * The tag is truncated to twelve base62 characters — about 71 bits. That is an
 * authenticity tag on a credential that lives for two minutes and is spent
 * once, not a key; forging it is not a realistic attack, and lengthening it
 * would break the 24-character contract the database enforces.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANDOM_LEN = 12;
const TAG_LEN = 12;
export const NONCE_LEN = RANDOM_LEN + TAG_LEN;

/** Domain separation, so this HMAC can never collide with the session token's. */
const TAG_PREFIX = "siwe-nonce:";

function secret(): string | null {
  return process.env.BETA_TOKEN_SECRET ?? null;
}

/** Base62 over the raw HMAC bytes. Modulo bias across 62 of 256 is irrelevant
    for an authenticity tag — the bytes are already unpredictable, and the tag
    is verified by equality against a recomputation, never guessed. */
function tagFor(random: string, key: string, context?: string): string {
  const hmac = createHmac("sha256", key).update(TAG_PREFIX + random);
  // Existing SIWE/proof nonces retain their exact wire format. New sign-in
  // and linking challenges additionally bind purpose and the target session.
  if (context) hmac.update("\u0000" + context);
  const mac = hmac.digest();
  let out = "";
  for (let i = 0; i < TAG_LEN; i += 1) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

/**
 * Mint a nonce this server can later recognise as its own.
 *
 * Returns `null` when the secret is absent rather than falling back to an
 * unauthenticated random string — a nonce nobody can verify is the hole this
 * module exists to close, and producing one silently would reopen it in the one
 * environment where the secret is missing.
 */
export function issueWalletNonce(context?: string): string | null {
  const key = secret();
  if (!key) return null;

  const bytes = randomBytes(RANDOM_LEN);
  let random = "";
  for (let i = 0; i < RANDOM_LEN; i += 1) random += ALPHABET[bytes[i] % ALPHABET.length];

  return random + tagFor(random, key, context);
}

/**
 * Whether this server minted the nonce.
 *
 * Says nothing about whether it has been spent — that is
 * `beta_consume_login_nonce`'s answer, and the caller must ask both.
 */
export function walletNonceIssuedHere(nonce: unknown, context?: string): boolean {
  const key = secret();
  if (!key) return false;
  if (typeof nonce !== "string" || nonce.length !== NONCE_LEN) return false;
  if (!/^[0-9A-Za-z]+$/.test(nonce)) return false;

  const random = nonce.slice(0, RANDOM_LEN);
  const given = Buffer.from(nonce.slice(RANDOM_LEN), "utf8");
  const expected = Buffer.from(tagFor(random, key, context), "utf8");
  /* Constant-time, because a comparison that returns early on the first wrong
     character leaks the tag one character at a time to anyone willing to
     measure. */
  return given.length === expected.length && timingSafeEqual(given, expected);
}
