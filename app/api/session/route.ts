import { NextRequest, NextResponse } from "next/server";
import { verifyLoginToken, issueSessionToken, issueAdminSessionToken, issueSessionRefToken } from "@/lib/beta/token";
import { loginNavigationAllowed, logoutNavigationAllowed } from "@/lib/security";
import { consumeLoginNonce, getState } from "@/lib/beta/rpc";
import { isAdminOperator } from "@/lib/admin/store";
import { loginTargetOf, recordAccountLogin } from "@/lib/admin/activity";
import { sessionOpen, sessionRevoke } from "@/lib/account/rpc";
import { ADMIN_IDLE_S, ADMIN_SESSION_TTL_S, CUSTOMER_SESSION_TTL_S } from "@/lib/auth/account-session";
import { verifySession } from "@/lib/beta/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_NEXT = /^\/(app|admin|demo|beta)(\/|$|\?)?/;
const USER_COOKIE_MAX_AGE = 30 * 24 * 3600; // matches SESSION_TTL_MS
const ADMIN_COOKIE_MAX_AGE = 24 * 3600; // matches ADMIN_SESSION_TTL_MS

/**
 * Exchanges a bot-issued LOGIN token (?t=) for a freshly-minted SESSION cookie, then redirects to
 * a clean URL. Purpose separation: only a login token (or a legacy token during compat) is
 * accepted here. The cookie value is a NEW session token, never the raw login token, and the
 * session remains inside an HttpOnly cookie.
 *
 * RYN-ACCESS-002: the session minted here is a RECORDED one whenever the
 * account's uuid is known — a row in `private.sessions` that can be revoked,
 * with the admin form carrying its idle limit. The stateless token stays as the
 * fallback for the window before the accounts migration is applied, so the
 * bot door never closes because of a migration's timing.
 */

function recoveryRedirect(origin: string, lang: string) {
  const target = new URL("/beta", origin);
  target.searchParams.set("auth", "refresh");
  if (lang) target.searchParams.set("lang", lang);
  return NextResponse.redirect(target);
}

async function revokeRecorded(token: string | undefined) {
  if (!token) return;
  const parsed = verifySession(token);
  if (parsed?.subject.kind === "session") await sessionRevoke(parsed.subject.sessionId, "logout");
}

/**
 * A recorded session when the account is known, the stateless token otherwise.
 * The recorded form is the one that can be revoked; the admin form also
 * carries its idle limit.
 */
async function mintSession(telegramId: number, admin: boolean, accountId: string | null): Promise<{ token: string; maxAge: number } | null> {
  if (accountId) {
    const opened = await sessionOpen({
      kind: admin ? "admin" : "customer",
      method: "telegram_link",
      accountId,
      ttlSeconds: admin ? ADMIN_SESSION_TTL_S : CUSTOMER_SESSION_TTL_S,
      idleSeconds: admin ? ADMIN_IDLE_S : null,
    });
    if (opened) {
      const token = issueSessionRefToken(opened.id, Date.parse(opened.expiresAt), admin);
      if (token) return { token, maxAge: Math.max(60, Math.floor((Date.parse(opened.expiresAt) - Date.now()) / 1000)) };
    }
  }
  const token = admin ? issueAdminSessionToken(telegramId) : issueSessionToken(telegramId);
  return token ? { token, maxAge: admin ? ADMIN_COOKIE_MAX_AGE : USER_COOKIE_MAX_AGE } : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("logout")) {
    if (!logoutNavigationAllowed(
      req.url,
      req.headers.get("sec-fetch-site"),
      req.headers.get("referer")
    )) {
      return NextResponse.redirect(new URL("/", url.origin));
    }
    /* Revocation first, cookie removal second: a copied cookie must not keep
       working after the person pressed «Вийти». */
    await Promise.all([revokeRecorded(req.cookies.get("rt")?.value), revokeRecorded(req.cookies.get("rta")?.value), revokeRecorded(req.cookies.get("rw")?.value)]);
    const res = NextResponse.redirect(new URL("/", url.origin));
    res.cookies.delete("rt");
    res.cookies.delete("rta");
    res.cookies.delete("rw");
    return res;
  }
  // Native Telegram sends Site:none; Telegram Web is cross-site. Allow the latter only for a
  // user-activated top-level document navigation, never for images, fetches or silent redirects.
  if (!loginNavigationAllowed(
    req.headers.get("sec-fetch-site"),
    req.headers.get("sec-fetch-mode"),
    req.headers.get("sec-fetch-user"),
    req.headers.get("sec-fetch-dest")
  )) {
    return NextResponse.redirect(new URL("/beta", url.origin));
  }

  const t = url.searchParams.get("t") ?? "";
  const lang = url.searchParams.get("lang") ?? "";
  let next = url.searchParams.get("next") ?? "/app";
  if (!ALLOWED_NEXT.test(next)) next = "/app";

  const login = verifyLoginToken(t);
  if (!login) {
    return recoveryRedirect(url.origin, lang);
  }

  if (login.admin && !(await isAdminOperator(login.telegramId))) {
    return recoveryRedirect(url.origin, lang);
  }

  if (login.jti) {
    const consumed = await consumeLoginNonce(login.jti, login.expiresAt);
    if (!consumed) return recoveryRedirect(url.origin, lang);
  }

  /* The account behind the Telegram id. Its uuid is what a recorded session
     is keyed on; a state that does not carry it yet (accounts migration not
     applied) leaves the stateless token as the only honest option. */
  const state = await getState(login.telegramId);
  const accountId = typeof state?.user.id === "string" ? state.user.id : null;

  // Mint a DISTINCT session token for the cookie — the login token never becomes the session.
  const minted = await mintSession(login.telegramId, login.admin, accountId);
  const sessionToken = minted?.token ?? null;
  if (!sessionToken || !minted) {
    return recoveryRedirect(url.origin, lang);
  }
  const maxAge = minted.maxAge;

  /* The confirmed login, recorded after the credential was verified, its
     nonce spent and the session minted — and only then. One row per nonce, so
     a retried or parallel exchange cannot count twice; bounded so a slow store
     never holds the redirect. Nothing about the outcome changes the session. */
  await recordAccountLogin(
    {
      accountId,
      telegramId: login.telegramId,
      kind: "telegram_link",
      admin: login.admin,
      target: loginTargetOf(next),
      nonce: login.jti,
    },
    { timeoutMs: 2_500 },
  );

  const res = NextResponse.redirect(new URL(next, url.origin));
  const cookieBase = {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
  };
  res.cookies.set("rt", sessionToken, { ...cookieBase, maxAge });
  if (login.admin) res.cookies.set("rta", sessionToken, { ...cookieBase, maxAge });
  return res;
}
