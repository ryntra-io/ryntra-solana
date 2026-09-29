import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import { accountMethods, customerMethods } from "@/lib/account/config";
import { cookieBase, establishAccount, loginKindFor, openCustomerSession, recordSessionLogin, summarizeIdentity } from "@/lib/auth/account-session";
import { ATTACH_COOKIE, ATTACH_COOKIE_OPTIONS, issueAttachIntent } from "@/lib/auth/attach-intent";
import { attachableAccountId, sessionKeyOf } from "@/lib/auth/identity-link";
import { deliveryOutcome, type DeliveryOutcome } from "@/lib/auth/mail-delivery";
import { RESET_PATH, safeReturnPath, withAuthMarker } from "@/lib/auth/return-path";
import { supabaseServer } from "@/lib/auth/supabase";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email + password, through Supabase Auth, server-side.
 *
 * The browser posts a small form; this handler forwards it to the identity
 * verifier over TLS and answers with a state the sheet can render. Nothing
 * about the answer says whether an address exists: sign-up and forgot-password
 * both report the same "check your mail" state, and a failed sign-in reports
 * "invalid" without saying which half was wrong. Supabase applies the same
 * discipline on its side (obfuscated responses, rate limits, confirmation
 * before the first sign-in).
 *
 * A successful sign-in resolves the account, opens a recorded product session
 * and sets the `rt` cookie. The Supabase session cookie stays alongside for
 * identity operations — password change, linking — and nothing else.
 */

const MAX_BODY_BYTES = 4_096;
const IP_LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 15, maxKeys: 10_000 });
const EMAIL_LIMITER = new FixedWindowLimiter({ windowMs: 10 * 60_000, limit: 8, maxKeys: 10_000 });

const BodySchema = z.object({
  action: z.enum(["signin", "signup", "resend", "forgot"]),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(256).optional(),
  next: z.string().max(512).optional(),
  locale: z.enum(["en", "uk"]).optional(),
  /** Bind the identity to the legacy account this browser already holds. */
  attach: z.boolean().optional(),
});

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...headers } });
}

function deliveryJson(outcome: DeliveryOutcome, accepted: Record<string, unknown>) {
  if (outcome === "rate_limited") return json({ status: "rate_limited" }, 429);
  if (outcome === "unavailable") return json({ status: "mail_unavailable" }, 503);
  return json(accepted);
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden" }, 403);
  }
  if (!accountMethods().email) return json({ error: "unavailable", status: "unavailable" }, 503);

  const ipDecision = IP_LIMITER.consume(`auth-email:${clientIp(req.headers)}`);
  if (!ipDecision.allowed) return json({ error: "rate limited", status: "rate_limited" }, 429, rateLimitHeaders(ipDecision));

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  let parsed: z.infer<typeof BodySchema>;
  try {
    const result = BodySchema.safeParse(JSON.parse(raw));
    if (!result.success) return json({ error: "bad request", status: "invalid" }, 400);
    parsed = result.data;
  } catch {
    return json({ error: "bad request", status: "invalid" }, 400);
  }

  /* Sign-in and sign-up are customer doors and shut with them; a password
     reset request and a confirmation resend stay on the operator's switch,
     because the operator's own recovery runs through the same address. */
  if ((parsed.action === "signin" || parsed.action === "signup") && !customerMethods().email) {
    return json({ error: "unavailable", status: "unavailable" }, 503);
  }

  const emailDecision = EMAIL_LIMITER.consume(`auth-email:${parsed.email}`);
  if (!emailDecision.allowed) return json({ error: "rate limited", status: "rate_limited" }, 429, rateLimitHeaders(emailDecision));

  const client = await supabaseServer();
  if (!client) return json({ error: "unavailable", status: "unavailable" }, 503);

  const origin = new URL(req.url).origin;
  const next = safeReturnPath(parsed.next);
  const confirmUrl = `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;

  if (parsed.action === "signup") {
    if (!parsed.password) return json({ error: "bad request", status: "invalid" }, 400);
    const { data, error } = await client.auth.signUp({
      email: parsed.email,
      password: parsed.password,
      options: { emailRedirectTo: confirmUrl, data: { locale: parsed.locale ?? "en" } },
    });
    /* Weak-password and similar policy refusals are the person's to fix; an
       existing address is not disclosed — Supabase answers with an obfuscated
       user and no session, which reads as "check your mail" here too. */
    if (error && /password/i.test(error.message) && /weak|short|least|character|pwned|breach/i.test(error.message)) return json({ status: "weak_password" }, 422);
    if (error) return deliveryJson(deliveryOutcome(error), { status: "confirm_email" });
    if (data.session && data.user) return signedIn(req, data.user, next, parsed.attach === true);

    /* Confirmation required, so the sign-in finishes in a mailbox and the
       instruction has to get there too. It travels as a signed, HttpOnly
       cookie in this browser, naming this session, this account and this
       address — not on the link, where anyone could add it and bind their own
       identity to whatever account the browser was holding. */
    const res = json({ status: "confirm_email" });
    if (parsed.attach === true) {
      const session = await getSession();
      const accountId = attachableAccountId(session);
      const context = sessionKeyOf(session);
      const issued = accountId && context ? issueAttachIntent({ purpose: "email_signup", context, accountId, subject: parsed.email }) : null;
      if (issued) res.cookies.set(ATTACH_COOKIE, issued.value, { ...ATTACH_COOKIE_OPTIONS, secure: new URL(req.url).protocol === "https:" });
    }
    return res;
  }

  if (parsed.action === "signin") {
    if (!parsed.password) return json({ error: "bad request", status: "invalid" }, 400);
    const { data, error } = await client.auth.signInWithPassword({ email: parsed.email, password: parsed.password });
    if (error) {
      if (/not confirmed/i.test(error.message)) return json({ status: "confirm_email" }, 403);
      if (error.status === 429) return json({ status: "rate_limited" }, 429);
      return json({ status: "invalid" }, 401);
    }
    if (!data.user) return json({ status: "invalid" }, 401);
    return signedIn(req, data.user, next, parsed.attach === true);
  }

  if (parsed.action === "resend") {
    const { error } = await client.auth.resend({ type: "signup", email: parsed.email, options: { emailRedirectTo: confirmUrl } });
    return deliveryJson(deliveryOutcome(error), { status: "confirm_email" });
  }

  /* forgot: the recovery mail lands on /auth/confirm (token hash) or
     /auth/callback (code) and continues to the reset page with only the
     identity session; the product session is minted after the new password. */
  const { error: recoveryError } = await client.auth.resetPasswordForEmail(parsed.email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(RESET_PATH)}`,
  });
  return deliveryJson(deliveryOutcome(recoveryError), { status: "recovery_sent" });
}

async function signedIn(req: NextRequest, user: User, next: string, attach = false) {
  const identity = summarizeIdentity(user, "email");
  /* The person asked, in the sheet, to keep the account this browser already
     holds. The account still has to qualify — reached through the bot, no
     identity of its own — and the target is named here rather than guessed
     later. Without the instruction nothing is attached and the identity gets
     its own account. */
  const attachTo = attach ? attachableAccountId(await getSession()) : null;
  const account = await establishAccount(identity, { attachTo });
  if (!account.ok) {
    return json({ status: "error", reason: account.error }, account.error === "unavailable" ? 503 : 409);
  }
  const kind = loginKindFor("email");
  const opened = await openCustomerSession({ accountId: account.accountId, method: kind });
  if (!opened) return json({ status: "error", reason: "session_store" }, 503);
  await recordSessionLogin({ accountId: account.accountId, sessionId: opened.sessionId, method: kind, next });
  const res = json({ status: "signed_in", next: withAuthMarker(next, "ok", account.isNew ? "new" : undefined) });
  res.cookies.set(opened.cookie.name, opened.cookie.value, { ...cookieBase(req.url), maxAge: opened.cookie.maxAge });
  return res;
}
