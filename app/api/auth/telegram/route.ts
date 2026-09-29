import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { customerMethods, telegramClientId } from "@/lib/account/config";
import { cookieBase, establishAccount, loginKindFor, openCustomerSession, recordSessionLogin, summarizeIdentity } from "@/lib/auth/account-session";
import { attachableAccountId } from "@/lib/auth/identity-link";
import { DEFAULT_RETURN_PATH, safeReturnPath, withAuthMarker } from "@/lib/auth/return-path";
import { ROUND_TRIP_COOKIE, ROUND_TRIP_COOKIE_OPTIONS, issueRoundTrip, readRoundTrip } from "@/lib/auth/round-trip";
import { supabaseServer } from "@/lib/auth/supabase";
import { readTelegramIdToken, telegramNonceFor, telegramTokenMatches } from "@/lib/auth/telegram-token";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign in with Telegram through Telegram Login's ID token.
 *
 * The redirect form of Telegram OpenID (`/api/auth/oauth` → Supabase →
 * Telegram → `/auth/callback`) verifies the person but loses the one claim the
 * product needs: Supabase keeps the standard claims and drops Telegram's
 * numeric `id`, so a bot customer signing in that way became a second account.
 * The `/auth/callback` route now refuses that case instead.
 *
 * This route is the way in that keeps the id. The browser asks Telegram Login
 * for an ID token (a popup on oauth.telegram.org), posts the token here, and
 * this handler gives it to Supabase to verify (`signInWithIdToken`, provider
 * `custom:telegram`: signature against Telegram's JWKS, issuer, audience,
 * expiry and nonce). Only after Supabase has turned the token into an identity
 * session does the handler read the `id` claim from the same token string and
 * resolve the account — an existing bot row by that id, or a new account.
 * Supabase stays the verifier; nothing here checks a signature.
 *
 *   GET   starts the round trip: a signed cookie with a fresh nonce, and the
 *         value Telegram must write into the token (the nonce's SHA-256).
 *   POST  finishes it: the ID token, the round trip cookie, one account.
 */

const GET_LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 10_000 });
const POST_LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 10, maxKeys: 10_000 });
const BodySchema = z.object({ idToken: z.string().min(20).max(8192), next: z.string().max(512).optional() });

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...headers } });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (!customerMethods().telegram) return json({ status: "off" }, 503);
  const decision = GET_LIMITER.consume(`auth-telegram-start:${clientIp(req.headers)}`);
  if (!decision.allowed) return json({ status: "rate_limited" }, 429, rateLimitHeaders(decision));

  const next = safeReturnPath(url.searchParams.get("next"), DEFAULT_RETURN_PATH);
  const attach = url.searchParams.get("attach") === "1";
  const trip = issueRoundTrip({ method: "telegram", purpose: "signin", next, attach });
  if (!trip) return json({ status: "unavailable" }, 503);

  const res = json({ status: "ready", clientId: telegramClientId(), nonce: telegramNonceFor(trip.trip.nonce) });
  res.cookies.set(ROUND_TRIP_COOKIE, trip.value, { ...ROUND_TRIP_COOKIE_OPTIONS, secure: url.protocol === "https:" });
  return res;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ status: "error", reason: "forbidden" }, 403);
  }
  if (!customerMethods().telegram) return json({ status: "off" }, 503);
  const decision = POST_LIMITER.consume(`auth-telegram:${clientIp(req.headers)}`);
  if (!decision.allowed) return json({ status: "rate_limited" }, 429, rateLimitHeaders(decision));

  let parsed: z.infer<typeof BodySchema>;
  try {
    const result = BodySchema.safeParse(await req.json());
    if (!result.success) return json({ status: "invalid" }, 400);
    parsed = result.data;
  } catch {
    return json({ status: "invalid" }, 400);
  }

  /* The round trip this browser started. A token without one is a token
     somebody carried here from elsewhere, whatever it says. */
  const trip = readRoundTrip(req.cookies.get(ROUND_TRIP_COOKIE)?.value);
  if (!trip || trip.method !== "telegram" || trip.purpose !== "signin") return json({ status: "error", reason: "state" }, 400);
  const next = safeReturnPath(parsed.next ?? trip.next, DEFAULT_RETURN_PATH);

  /* `state` is a round trip that is missing or expired; `nonce` is a token
     that does not carry this round trip's nonce. They look the same to the
     person (start again) but not to whoever reads the logs of a failed real
     journey, so they are told apart here. */
  const claims = readTelegramIdToken(parsed.idToken);
  if (!claims || !telegramTokenMatches(claims, trip.nonce)) return json({ status: "error", reason: "nonce" }, 400);

  const client = await supabaseServer();
  if (!client) return json({ status: "unavailable" }, 503);

  /* Supabase verifies the token. Its refusal ends the request; its acceptance
     is the only reason the claims read above are trusted below. */
  const verified = await client.auth.signInWithIdToken({ provider: "custom:telegram", token: parsed.idToken, nonce: trip.nonce });
  if (verified.error || !verified.data.user) return json({ status: "error", reason: "verify" }, 401);

  const summary = summarizeIdentity(verified.data.user, "telegram");
  const identity = { ...summary, telegramId: claims.telegramId ?? summary.telegramId, displayName: summary.displayName ?? claims.name ?? claims.username };

  const attachTo = trip.attach === true ? attachableAccountId(await getSession()) : null;
  const account = await establishAccount(identity, { attachTo });
  if (!account.ok) return json({ status: "error", reason: account.error }, account.error === "unavailable" ? 503 : 409);

  const kind = loginKindFor("telegram");
  const opened = await openCustomerSession({ accountId: account.accountId, method: kind });
  if (!opened) return json({ status: "error", reason: "session_store" }, 503);
  await recordSessionLogin({ accountId: account.accountId, sessionId: opened.sessionId, method: kind, next });

  const res = json({ status: "signed_in", next: withAuthMarker(next, "ok", account.isNew ? "new" : undefined), linkedLegacy: account.linkedLegacy });
  res.cookies.delete(ROUND_TRIP_COOKIE);
  res.cookies.set(opened.cookie.name, opened.cookie.value, { ...cookieBase(url.toString()), maxAge: opened.cookie.maxAge });
  return res;
}
