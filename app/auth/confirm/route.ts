import { NextRequest, NextResponse } from "next/server";

import { accountMethods } from "@/lib/account/config";
import { ATTACH_COOKIE, attachIntentMatches, readAttachIntent } from "@/lib/auth/attach-intent";
import { cookieBase, establishAccount, loginKindFor, openCustomerSession, recordSessionLogin, summarizeIdentity } from "@/lib/auth/account-session";
import { DEFAULT_RETURN_PATH, RESET_PATH, safeReturnPath, withAuthMarker } from "@/lib/auth/return-path";
import { attachableAccountId, sessionKeyOf } from "@/lib/auth/identity-link";
import { supabaseServer } from "@/lib/auth/supabase";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email links in their token-hash form: sign-up confirmation, recovery and
 * email change (`{{ .TokenHash }}` templates).
 *
 * `verifyOtp` spends the one-time hash at Supabase and yields an identity
 * session. A confirmed sign-up becomes a product session immediately; a
 * recovery continues to the reset page carrying only the identity session,
 * and the product session is minted after the new password is set. A hash
 * that was already used or has expired lands the person back with
 * `auth=error&reason=link`, where the sheet offers to send a fresh one.
 */

const TYPES = ["signup", "email", "recovery", "email_change", "invite", "magiclink"] as const;
type OtpType = (typeof TYPES)[number];

function redirect(origin: string, path: string) {
  const res = NextResponse.redirect(new URL(path, origin), { headers: privateNoStoreHeaders() });
  /* The instruction is spent, whatever the outcome: it must not survive to be
     matched against a different confirmation later. */
  res.cookies.delete(ATTACH_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requested = url.searchParams.get("next");
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type");
  const type = TYPES.find((t) => t === typeParam) ?? null;
  const next = safeReturnPath(requested, type === "recovery" ? RESET_PATH : DEFAULT_RETURN_PATH);

  /* Both landings accept both forms. Supabase's stock templates use
     `{{ .ConfirmationURL }}`, which verifies at the Auth server and comes back
     to `emailRedirectTo` carrying a PKCE `code`; the templates written for this
     product use `{{ .TokenHash }}` and land here. Whichever the owner has
     configured, the person must not meet «посилання недійсне» because the mail
     chose the other door, so each route hands the other form over rather than
     refusing it. */
  const code = url.searchParams.get("code");
  if (!tokenHash && code) {
    const handover = new URL("/auth/callback", url.origin);
    handover.search = url.search;
    return redirect(url.origin, `${handover.pathname}${handover.search}`);
  }
  if (!tokenHash || tokenHash.length > 512 || !type) return redirect(url.origin, withAuthMarker(next, "error", "link"));

  /* Off is off on the server too: a link mailed while the door was open must
     not still spend its token after the owner turned the door off. */
  if (!accountMethods().email) return redirect(url.origin, withAuthMarker(next, "error", "method_off"));

  const client = await supabaseServer();
  if (!client) return redirect(url.origin, withAuthMarker(next, "error", "unavailable"));

  const verified = await client.auth.verifyOtp({ type: type as OtpType, token_hash: tokenHash });
  if (verified.error || !verified.data.user) return redirect(url.origin, withAuthMarker(next, "error", "link"));

  if (type === "recovery") return redirect(url.origin, RESET_PATH);

  /* A confirmation link is proof of one mailbox, not an instruction to join
     whatever account this browser is holding — confirming a signup in an
     operator's browser used to bind that identity to the operator. An attach
     happens only when the person asked for it in the sheet, and only in the
     browser that asked: the instruction is a signed cookie naming this
     session, this account and this exact address. Everything else confirms
     into an account of its own. */
  const identity = summarizeIdentity(verified.data.user, "email");
  const session = await getSession();
  const live = {
    purpose: "email_signup" as const,
    context: sessionKeyOf(session) ?? "",
    accountId: attachableAccountId(session) ?? "",
    subject: identity.email ?? "",
  };
  const instructed = Boolean(live.context && live.accountId && live.subject) && attachIntentMatches(readAttachIntent(req.cookies.get(ATTACH_COOKIE)?.value), live);
  const account = await establishAccount(identity, { attachTo: instructed ? live.accountId : null });
  if (!account.ok) return redirect(url.origin, withAuthMarker(next, "error", account.error));

  const kind = loginKindFor("email");
  const opened = await openCustomerSession({ accountId: account.accountId, method: kind });
  if (!opened) return redirect(url.origin, withAuthMarker(next, "error", "session_store"));
  await recordSessionLogin({ accountId: account.accountId, sessionId: opened.sessionId, method: kind, next });

  const res = redirect(url.origin, withAuthMarker(next, "ok", account.isNew ? "new" : undefined));
  res.cookies.set(opened.cookie.name, opened.cookie.value, { ...cookieBase(req.url), maxAge: opened.cookie.maxAge });
  return res;
}
