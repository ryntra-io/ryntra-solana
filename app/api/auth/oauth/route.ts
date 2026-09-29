import { NextRequest, NextResponse } from "next/server";

import { customerMethods, supabaseProviderFor } from "@/lib/account/config";
import { DEFAULT_RETURN_PATH, safeReturnPath, withAuthMarker } from "@/lib/auth/return-path";
import { ROUND_TRIP_COOKIE, ROUND_TRIP_COOKIE_OPTIONS, issueRoundTrip, type RoundTripPurpose } from "@/lib/auth/round-trip";
import { supabaseServer } from "@/lib/auth/supabase";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders } from "@/lib/http-control";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a Google or Telegram round trip.
 *
 * Supabase builds the provider URL with PKCE; this handler remembers where to
 * come back to and which door was chosen in a signed, short-lived cookie, and
 * sends the browser away. `purpose=link` attaches the identity to the account
 * already signed in instead of signing in; it needs a live Supabase session,
 * which a person who signed in through Supabase still has.
 */

const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 10_000 });

function back(origin: string, next: string, marker: "error" | "cancel", reason: string) {
  return NextResponse.redirect(new URL(withAuthMarker(next, marker, reason), origin), { headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = safeReturnPath(url.searchParams.get("next"), DEFAULT_RETURN_PATH);
  const decision = LIMITER.consume(`auth-oauth:${clientIp(req.headers)}`);
  if (!decision.allowed) return back(url.origin, next, "error", "rate_limited");

  const providerParam = url.searchParams.get("provider");
  const method = providerParam === "google" || providerParam === "telegram" ? providerParam : null;
  if (!method) return back(url.origin, next, "error", "bad_provider");
  if (!customerMethods()[method]) return back(url.origin, next, "error", "method_off");

  const purposeParam = url.searchParams.get("purpose");
  const purpose: RoundTripPurpose = purposeParam === "link" ? "link" : "signin";
  const attach = url.searchParams.get("attach") === "1";

  const client = await supabaseServer();
  if (!client) return back(url.origin, next, "error", "unavailable");

  const trip = issueRoundTrip({ method, purpose, next, attach });
  if (!trip) return back(url.origin, next, "error", "unavailable");

  const redirectTo = `${url.origin}/auth/callback?state=${encodeURIComponent(trip.trip.nonce)}`;
  const provider = supabaseProviderFor(method);

  let target: string | null = null;
  if (purpose === "link") {
    /* Linking needs an account session in the product and an identity session
       at the verifier; without either there is nothing to attach to. */
    const session = await getSession();
    if (!session?.accountId) return back(url.origin, next, "error", "signed_out");
    const { data, error } = await client.auth.linkIdentity({
      provider: provider as "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) return back(url.origin, next, "error", "link_start");
    target = data.url;
  } else {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: provider as "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) return back(url.origin, next, "error", "oauth_start");
    target = data.url;
  }

  const res = NextResponse.redirect(target, { headers: privateNoStoreHeaders() });
  res.cookies.set(ROUND_TRIP_COOKIE, trip.value, { ...ROUND_TRIP_COOKIE_OPTIONS, secure: url.protocol === "https:" });
  return res;
}
