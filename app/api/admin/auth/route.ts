import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountMethods } from "@/lib/account/config";
import { accountBindAuth } from "@/lib/account/rpc";
import { adminMfaState, mfaIsFresh, openAdminSession, reverifyAdminMfa } from "@/lib/admin/auth";
import { appendAdminAudit } from "@/lib/admin/store";
import { attachIntentMatches, issueAttachIntent, readAttachIntent } from "@/lib/auth/attach-intent";
import { cookieBase, recordSessionLogin, summarizeIdentity } from "@/lib/auth/account-session";
import { supabaseServer, supabaseVerifiedUser } from "@/lib/auth/supabase";
import { getState } from "@/lib/beta/rpc";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSessionDetail } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The admin login's server side.
 *
 *   status   where the person stands (signed out, no account, not an operator,
 *            enrol, verify, ready)
 *   enroll   start TOTP enrolment: the QR and secret go straight to the
 *            response for the owner's screen and are not kept anywhere here
 *   verify   a code against a factor (enrolment or challenge); success lifts the
 *            identity session to aal2
 *   open     at aal2, open the recorded privileged session and set `rta`
 *   reverify a fresh code for a sensitive action on a live admin session
 *   attach   from the transitional bot admin session: bind the signed-in
 *            Supabase user to the operator's account, once, so email/Google
 *            can open the admin from then on
 *
 * Every step is audited by action and outcome; no code, secret or QR is ever
 * part of an audit payload.
 */

const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 5_000 });

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("verify"), factorId: z.string().min(8).max(128), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("open") }),
  z.object({ action: z.literal("reverify"), code: z.string().regex(/^\d{6}$/), factorId: z.string().min(8).max(128).optional() }),
  z.object({ action: z.literal("attach_intent") }),
  z.object({ action: z.literal("attach"), intent: z.string().min(16).max(2048), accountId: z.string().uuid() }),
]);

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...headers } });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const decision = LIMITER.consume(`admin-auth:${clientIp(req.headers)}`);
  if (!decision.allowed) return json({ error: "rate limited" }, 429, rateLimitHeaders(decision));

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "bad request" }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "bad request" }, 400);
  }

  /* The account door carries the admin's new login. While it is off, this
     endpoint answers as unavailable rather than trusting the panel to hide
     itself; the transitional bot path is unaffected and stays the way in. */
  if (!accountMethods().email) return json({ status: "unavailable" }, 503);

  const client = await supabaseServer();
  if (!client) return json({ status: "unavailable" }, 503);

  if (body.action === "reverify") {
    const result = await reverifyAdminMfa(body.code, body.factorId);
    const admin = await getAdminSessionDetail();
    if (admin) await appendAdminAudit({ actorTelegramId: admin.telegramId, action: "admin_mfa_reverify", outcome: result === "ok" ? "ok" : "rejected", reason: result });
    const status = result === "ok" ? 200 : result === "invalid" ? 422 : result === "unauthorized" ? 401 : result === "mismatch" ? 409 : 503;
    return json({ status: result }, status);
  }

  if (body.action === "attach_intent" || body.action === "attach") {
    /* The transitional bot admin session is the bootstrap authority: it says
       which account is the operator's; the Supabase session says which
       identity is being attached. Both must be present and both must be named
       in the confirmation, so that what the owner reads on the screen is what
       the server binds — not whatever the browser happens to hold a moment
       later. */
    const admin = await getAdminSessionDetail();
    if (!admin) return json({ error: "unauthorized" }, 401);
    const user = await supabaseVerifiedUser(client);
    if (!user) return json({ status: "signed_out" }, 401);
    const accountId = admin.accountId ?? (await getState(admin.telegramId))?.user.id ?? null;
    if (!accountId) return json({ status: "no_account" }, 409);
    const live = { purpose: "admin_bootstrap" as const, context: admin.sessionId ?? `tg:${admin.telegramId}`, accountId, subject: user.id };

    if (body.action === "attach_intent") {
      const issued = issueAttachIntent(live);
      if (!issued) return json({ status: "unavailable" }, 503);
      const summary = summarizeIdentity(user);
      return json({
        status: "intent",
        intent: issued.value,
        accountId,
        provider: summary.provider,
        email: summary.email,
        expiresInSeconds: 300,
      });
    }

    if (body.accountId !== accountId) return json({ status: "context_changed" }, 409);
    if (!attachIntentMatches(readAttachIntent(body.intent), live)) return json({ status: "context_changed" }, 409);

    const bound = await accountBindAuth(accountId, user.id);
    await appendAdminAudit({ actorTelegramId: admin.telegramId, action: "admin_identity_attach", outcome: bound.ok ? "ok" : "rejected", reason: bound.ok ? summarizeIdentity(user).provider : bound.error });
    return json({ status: bound.ok ? "attached" : bound.error }, bound.ok ? 200 : 409);
  }

  const state = await adminMfaState(client);

  if (body.action === "status") {
    /* The factor travels with the status. Without it a browser that has never
       enrolled anything — a new laptop, a cleared profile — could see «verify»
       and have nothing to verify against, and the panel posted an undefined
       factor id straight into a 400. */
    return json({
      status: state.status,
      operator: "operator" in state ? { role: state.operator.role, displayName: state.operator.displayName } : null,
      factorId: state.status === "verify" ? state.factorId : null,
      factors: state.status === "verify" || state.status === "ready" ? state.factors.length : 0,
      mfaFresh: state.status === "ready" ? mfaIsFresh(state.mfaAt) : false,
    });
  }

  if (body.action === "enroll") {
    if (state.status !== "enrol" && state.status !== "verify" && state.status !== "ready") return json({ status: state.status }, 403);
    /* Supabase keeps friendly names unique per user, so the backup
       authenticator on a second device needs its own: «Ryntra admin 2». */
    const factorNumber = (state.status === "verify" || state.status === "ready" ? state.factors.length : 0) + 1;
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Ryntra admin ${factorNumber}`, issuer: "Ryntra" });
    if (error || !data || data.type !== "totp") return json({ status: "unavailable" }, 503);
    await appendAdminAudit({ actorTelegramId: state.operator.telegramId, action: "admin_mfa_enroll", outcome: "attempt" });
    /* The secret and QR are the owner's to scan; they pass through this
       response once and are never logged, stored or echoed again. */
    return json({ status: "enrolling", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
  }

  if (body.action === "verify") {
    if (state.status !== "enrol" && state.status !== "verify" && state.status !== "ready") return json({ status: state.status }, 403);
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: body.factorId, code: body.code });
    await appendAdminAudit({ actorTelegramId: state.operator.telegramId, action: "admin_mfa_verify", outcome: verified.error ? "rejected" : "ok" });
    if (verified.error) return json({ status: "invalid" }, 422);
    return json({ status: "verified" });
  }

  /* open */
  if (state.status !== "ready") return json({ status: state.status }, 403);
  const user = await supabaseVerifiedUser(client);
  if (!user) return json({ status: "signed_out" }, 401);
  if (user.id !== state.authUserId) return json({ status: "signed_out" }, 401);
  const identity = summarizeIdentity(user);
  const method = identity.provider === "google" ? "google_oidc" : identity.provider === "telegram" ? "telegram_oidc" : "email_password";
  const opened = await openAdminSession({ accountId: state.accountId, method, authSessionId: null, mfaFresh: mfaIsFresh(state.mfaAt) });
  if (!opened) return json({ status: "unavailable" }, 503);
  await recordSessionLogin({ accountId: state.accountId, sessionId: opened.sessionId, method, admin: true, next: "/admin" });
  await appendAdminAudit({ actorTelegramId: state.operator.telegramId, action: "admin_login", outcome: "ok", reason: method });
  const res = json({ status: "opened", next: "/admin" });
  res.cookies.set("rta", opened.token, { ...cookieBase(req.url), maxAge: opened.maxAge });
  return res;
}
