/**
 * The provider's bot check on sign-in.
 *
 * When many people start a sign-in at once, the provider stops issuing
 * nonces (or magic links) and answers `challenge_required` with a Cloudflare
 * Turnstile site key instead. Before this module the server treated that
 * answer as an outage, so a busy minute locked everyone out. Now it is a
 * state of its own: the route answers CHALLENGE_REQUIRED with the site key,
 * the browser shows the check, and the same start is sent again with the
 * token the check gave — the person sees one small box, not an error.
 *
 * The site key comes with the challenge; when the provider leaves it out, it
 * is read from `GET /bot-protection/site-key` (public, the app id is the
 * only header it needs) and kept for ten minutes. The token is the browser's
 * word for one attempt: it is passed through once and never stored or
 * logged.
 *
 * Server only; the shapes are the provider's own, so the email start (a
 * magic link) goes through the same function as the wallet start (a nonce).
 */

import { failure, type PredictionFailure } from "./failure.ts";
import type { Result } from "./provider.ts";

/** Cloudflare's tokens run to about two thousand characters; anything longer is not one. */
export const TURNSTILE_TOKEN_MAX = 2048;
/** Printable, no spaces: a token is passed on as given, so nothing else may ride in it. */
const TOKEN = /^[\x21-\x7e]+$/;
/** A Turnstile site key: `0x…` for a real one, `1x…`–`3x…` for Cloudflare's own test keys. */
const SITE_KEY = /^[0-9]x[0-9A-Za-z_-]{8,120}$/;
const SITE_KEY_TTL_MS = 10 * 60_000;

export function isTurnstileToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= TURNSTILE_TOKEN_MAX && TOKEN.test(value);
}

export function validSiteKey(value: unknown): string | null {
  return typeof value === "string" && SITE_KEY.test(value) ? value : null;
}

/** The start body with the check's token added — only when there is one, so a first attempt reads exactly as before. */
export function withTurnstile<B extends object>(body: B, token: string | null | undefined): B & { turnstileToken?: string } {
  return isTurnstileToken(token) ? { ...body, turnstileToken: token } : body;
}

/**
 * The provider asks for the check in its answer (`{ type: "challenge_required", siteKey }`),
 * or — should it ever refuse instead — in an error: its code, or the SDK's own
 * `TurnstileChallengeError`, which carries the site key.
 */
export function challengeOf(answerOrError: unknown): Readonly<{ siteKey: string | null }> | null {
  const value = answerOrError as { type?: unknown; code?: unknown; name?: unknown; siteKey?: unknown } | null;
  if (!value || typeof value !== "object") return null;
  if (value.type === "challenge_required" || value.code === "challenge_required" || value.name === "TurnstileChallengeError") return { siteKey: validSiteKey(value.siteKey) };
  return null;
}

/** A key read is kept ten minutes; a failed read thirty seconds, so a burst of sign-ins does not ask again and again. */
const SITE_KEY_MISS_TTL_MS = 30_000;
const SITE_KEY_TIMEOUT_MS = 5_000;
let siteKeyCache: { at: number; key: string | null } | null = null;
let siteKeyRead: Promise<string | null> | null = null;

/** For tests: forget the kept site key. */
export function resetBotSiteKey(): void {
  siteKeyCache = null;
  siteKeyRead = null;
}

/** The app's Turnstile site key from the provider, one read at a time, kept ten minutes; null when it cannot be read within five seconds. */
export async function readBotSiteKey(
  env: Readonly<{ baseUrl: string; appId: string }>,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (siteKeyCache && nowMs - siteKeyCache.at < (siteKeyCache.key ? SITE_KEY_TTL_MS : SITE_KEY_MISS_TTL_MS)) return siteKeyCache.key;
  if (siteKeyRead) return siteKeyRead;
  siteKeyRead = (async () => {
    let key: string | null = null;
    try {
      const response = await fetchImpl(`${env.baseUrl}/bot-protection/site-key`, { headers: { accept: "application/json", "x-app-id": env.appId }, cache: "no-store", signal: AbortSignal.timeout(SITE_KEY_TIMEOUT_MS) });
      if (response.ok) key = validSiteKey(((await response.json()) as { siteKey?: unknown })?.siteKey);
    } catch {
      key = null;
    }
    siteKeyCache = { at: nowMs, key };
    return key;
  })().finally(() => {
    siteKeyRead = null;
  });
  return siteKeyRead;
}

/** What the route answers when the provider wants the check: the site key to show it with, or — when no key can be found — an honest outage. */
export async function challengeFailure(offered: string | null, lookup: () => Promise<string | null>): Promise<PredictionFailure> {
  const siteKey = offered ?? (await Promise.resolve().then(lookup).catch(() => null));
  return siteKey
    ? failure("CHALLENGE_REQUIRED", "Confirm you are a person to continue signing in.", { siteKey })
    : failure("PROVIDER_UNAVAILABLE", "Sign-in is busy right now; try again in a moment.");
}

/** A start that carried a token and was asked for the check again: the token was refused, and asking once more would only loop. */
function refusedToken(): PredictionFailure {
  return failure("CHALLENGE_FAILED", "The check did not pass; start the sign-in again.");
}

/**
 * One sign-in start through the bot check: the body (with the token when
 * the browser has one) goes to the provider; a challenge comes back as
 * CHALLENGE_REQUIRED with its site key — or CHALLENGE_FAILED when the start
 * already carried a token — any other answer as it is. `start` is the
 * provider call; any other error it throws is rethrown for the caller to
 * classify.
 */
export async function startThroughBotCheck<B extends object, A extends { type: string }>(
  start: (body: B & { turnstileToken?: string }) => Promise<A>,
  body: B,
  token: string | null | undefined,
  lookup: () => Promise<string | null>,
): Promise<Result<Exclude<A, { type: "challenge_required" }>>> {
  let answer: A;
  try {
    answer = await start(withTurnstile(body, token));
  } catch (error) {
    const asked = challengeOf(error);
    if (asked) return isTurnstileToken(token) ? refusedToken() : challengeFailure(asked.siteKey, lookup);
    throw error;
  }
  const asked = challengeOf(answer);
  if (asked) return isTurnstileToken(token) ? refusedToken() : challengeFailure(asked.siteKey, lookup);
  return { ok: true, value: answer as Exclude<A, { type: "challenge_required" }> };
}
