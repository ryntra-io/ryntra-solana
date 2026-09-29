import { NextRequest, NextResponse } from "next/server";

import { customerMethods } from "@/lib/account/config";
import { accountBindAuth } from "@/lib/account/rpc";
import { cookieBase, establishAccount, loginKindFor, openCustomerSession, recordSessionLogin, summarizeIdentity } from "@/lib/auth/account-session";
import { DEFAULT_RETURN_PATH, safeReturnPath, withAuthMarker } from "@/lib/auth/return-path";
import { attachableAccountId, matchIdentity } from "@/lib/auth/identity-link";
import { ROUND_TRIP_COOKIE, readRoundTrip } from "@/lib/auth/round-trip";
import { supabaseServer } from "@/lib/auth/supabase";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The end of an identity round trip: OAuth (Google, Telegram OpenID Connect)
 * and the PKCE form of the email links.
 *
 * The code in the URL is exchanged with Supabase for an identity session; the
 * verified user is read back from the server, never decoded from the URL.
 * Where to go next and what the trip was for come from the signed cookie set
 * when the trip started — or, for an email link that started in a mailbox,
 * from an allowlisted `next` on the link itself. Whatever happens, the person
 * lands back on the page they left with one marker the client reads once:
 * `auth=ok`, `auth=cancel` or `auth=error&reason=…`. Nothing financial resumes
 * on its own.
 */

function redirect(origin: string, path: string, clearTrip = true) {
  const res = NextResponse.redirect(new URL(path, origin), { headers: privateNoStoreHeaders() });
  if (clearTrip) res.cookies.delete(ROUND_TRIP_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const trip = readRoundTrip(req.cookies.get(ROUND_TRIP_COOKIE)?.value);
  const next = safeReturnPath(trip?.next ?? url.searchParams.get("next"), DEFAULT_RETURN_PATH);

  /* A provider that sent the person back without a code said no, or failed. */
  const providerError = url.searchParams.get("error");
  if (providerError) {
    const cancelled = providerError === "access_denied" || url.searchParams.get("error_description")?.toLowerCase().includes("cancel");
    return redirect(url.origin, withAuthMarker(next, cancelled ? "cancel" : "error", cancelled ? undefined : "provider"));
  }

  const code = url.searchParams.get("code");
  /* The other half of the handover in `/auth/confirm`: a `{{ .TokenHash }}`
     template that points here is answered by the route that spends token
     hashes, not by «no code». It runs before the customer doors are read,
     because a token hash is the operator's recovery mail as often as a
     customer's, and `/auth/confirm` keeps the operator's own switch. */
  if (!code && url.searchParams.get("token_hash")) {
    const handover = new URL("/auth/confirm", url.origin);
    handover.search = url.search;
    return redirect(url.origin, `${handover.pathname}${handover.search}`);
  }

  /* A door that is off is closed on the server, not only in the sheet that
     draws the buttons. Someone holding an old provider URL, or calling this
     route directly, must meet the same refusal as someone who sees no button
     at all. The customer doors (RYN-ACCESS-WALLET-ONLY-001) are the ones
     read here: this route only ever finishes a customer's trip. */
  const methods = customerMethods();
  const tripMethod = trip?.method === "google" || trip?.method === "telegram" ? trip.method : "email";
  if (!methods[tripMethod]) return redirect(url.origin, withAuthMarker(next, "error", "method_off"));
  if (!code || code.length > 512) return redirect(url.origin, withAuthMarker(next, "error", "no_code"));

  /* A trip that started here must come back with its own nonce; a trip that
     started in a mailbox has none, and the PKCE verifier in the cookie jar is
     what binds that one to this browser. */
  const state = url.searchParams.get("state");
  if (trip && (!state || state !== trip.nonce)) return redirect(url.origin, withAuthMarker(next, "error", "state"));

  const client = await supabaseServer();
  if (!client) return redirect(url.origin, withAuthMarker(next, "error", "unavailable"));

  const exchanged = await client.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.user) return redirect(url.origin, withAuthMarker(next, "error", "exchange"));

  const identity = summarizeIdentity(exchanged.data.user, trip?.method === "google" || trip?.method === "telegram" ? trip.method : undefined);

  if (trip?.purpose === "link") {
    /* Linking adds a provider to the identity the account already has, so the
       account and the returned user must be the same person. `match` means the
       identity session came back as the account's own user and Supabase has
       already recorded the new provider — there is nothing left to bind.
       `unbound` is the legacy account taking its first identity, and only with
       the person's explicit attach instruction. Anything else is two people in
       one browser and is refused without touching either account. */
    const session = await getSession();
    if (!session?.accountId) return redirect(url.origin, withAuthMarker(next, "error", "signed_out"));
    const agreement = await matchIdentity(session, identity.authUserId);
    if (agreement === "unavailable") return redirect(url.origin, withAuthMarker(next, "error", "unavailable"));
    if (agreement === "match") return redirect(url.origin, withAuthMarker(next, "ok", "linked"));
    if (agreement === "mismatch") return redirect(url.origin, withAuthMarker(next, "error", "identity_mismatch"));
    const target = trip.attach === true ? attachableAccountId(session) : null;
    if (!target) return redirect(url.origin, withAuthMarker(next, "error", "attach_intent"));
    const bound = await accountBindAuth(target, identity.authUserId);
    if (!bound.ok) return redirect(url.origin, withAuthMarker(next, "error", bound.error));
    return redirect(url.origin, withAuthMarker(next, "ok", "linked"));
  }

  /* Recovery links land here too when the mail template uses the PKCE form;
     the person continues to the reset page with only the identity session. */
  if (next.startsWith("/app/settings/reset")) return redirect(url.origin, next);

  /* Signing in is allowed to change who the browser is acting as. What it may
     not do is bind this identity to whoever was signed in a moment ago, so the
     target account is resolved here, from an explicit instruction, and never
     inferred inside `establishAccount`. */
  const attachTo = trip?.attach === true ? attachableAccountId(await getSession()) : null;
  const account = await establishAccount(identity, { attachTo });
  if (!account.ok) return redirect(url.origin, withAuthMarker(next, "error", account.error));

  const method = trip?.method === "google" || trip?.method === "telegram" ? trip.method : identity.provider === "google" || identity.provider === "telegram" ? identity.provider : "email";
  const kind = loginKindFor(method);
  const opened = await openCustomerSession({ accountId: account.accountId, method: kind });
  if (!opened) return redirect(url.origin, withAuthMarker(next, "error", "session_store"));
  await recordSessionLogin({ accountId: account.accountId, sessionId: opened.sessionId, method: kind, next });

  const res = redirect(url.origin, withAuthMarker(next, "ok", account.isNew ? "new" : undefined));
  res.cookies.set(opened.cookie.name, opened.cookie.value, { ...cookieBase(req.url), maxAge: opened.cookie.maxAge });
  return res;
}
