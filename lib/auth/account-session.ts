import { issueSessionRefToken } from "@/lib/beta/token";
import { accountBindAuth, accountByAuthUser, accountResolveAuth, sessionOpen, type AccountResolveResult, type SessionMethod } from "@/lib/account/rpc";
import { loginTargetOf, recordAccountLogin } from "@/lib/admin/activity";
import { telegramIdMissing, type IdentitySummary } from "./identity-summary";

export { summarizeIdentity, telegramIdOf } from "./identity-summary";
export type { IdentityProvider, IdentitySummary } from "./identity-summary";

/**
 * From a verified identity to a product session — the one path every door
 * shares once Supabase Auth has said who a person is.
 *
 *   1. summarize the verified user (which provider, which Telegram id the
 *      OpenID identity carries, a display name, a language hint) — the pure
 *      part lives in `identity-summary.ts`;
 *   2. resolve the account: found, bound to a legacy bot row, or created;
 *   3. open a recorded session and sign a cookie that names it;
 *   4. record the confirmed login once, keyed by the session id.
 *
 * Nothing here trusts the browser: the user comes from `getUser()`, the
 * account from the database, the cookie from the server's own signature.
 */

export const CUSTOMER_SESSION_TTL_S = 30 * 24 * 3600;
export const WALLET_PROOF_TTL_S = 24 * 3600;
export const ADMIN_SESSION_TTL_S = 12 * 3600;
export const ADMIN_IDLE_S = 30 * 60;

export function loginKindFor(method: "email" | "google" | "telegram" | "recovery"): SessionMethod {
  switch (method) {
    case "google":
      return "google_oidc";
    case "telegram":
      return "telegram_oidc";
    case "recovery":
      return "email_recovery";
    default:
      return "email_password";
  }
}

/**
 * The store's answer, or the one refusal this layer adds on its own:
 * `telegram_identity` — a Telegram identity that arrived without its numeric
 * user id, which no account may be created for.
 */
export type EstablishAccountResult = AccountResolveResult | { ok: false; error: "telegram_identity" };

/**
 * The account behind a verified identity.
 *
 * 1. An identity already bound to an account resolves to it.
 * 2. Otherwise, when the caller passes a concrete `attachTo` account, the
 *    identity is bound to it: one person, two doors, no second account. The
 *    caller — not this function — is responsible for having an explicit
 *    instruction from the person and for checking that the account qualifies
 *    (`attachableAccountId`). **Attaching never happens by default.** Reading
 *    the browser's cookies here is what made a signup confirmed in an
 *    operator's browser bind itself to the operator's account, so nothing
 *    about the current request is consulted any more.
 * 3. Otherwise the identity resolves the usual way: a legacy row matched by
 *    Telegram id, or a new account — except that a Telegram identity without
 *    its numeric id is refused here. It cannot be matched to the bot account
 *    the person may already hold, and the first real sign-in showed what the
 *    store does with it otherwise: a second, empty account. Steps 1 and 2
 *    still work for such an identity; only the guess is refused.
 */
export async function establishAccount(identity: IdentitySummary, options: { attachTo?: string | null } = {}): Promise<EstablishAccountResult> {
  const existing = await accountByAuthUser(identity.authUserId);
  if (existing) return { ok: true, accountId: existing, isNew: false, linkedLegacy: false };

  const target = options.attachTo ?? null;
  if (existing === null && target) {
    const bound = await accountBindAuth(target, identity.authUserId);
    if (bound.ok) return { ok: true, accountId: target, isNew: false, linkedLegacy: true };
    /* A refused bind is a collision, never a reason to quietly make a second
       account for somebody who asked to join an existing one. */
    if (bound.error === "account_bound" || bound.error === "auth_user_claimed") return { ok: false, error: bound.error };
  }

  if (telegramIdMissing(identity)) return { ok: false, error: "telegram_identity" };

  return accountResolveAuth({
    authUserId: identity.authUserId,
    telegramId: identity.telegramId,
    displayName: identity.displayName,
    language: identity.language,
  });
}

export type SessionCookie = Readonly<{ name: "rt" | "rta" | "rw"; value: string; maxAge: number }>;

/**
 * Open a recorded customer session and sign the cookie that names it.
 * Returns `null` when the store did not answer — the caller then refuses to
 * sign anyone in rather than falling back to an unrevocable token.
 */
export async function openCustomerSession(input: Readonly<{
  accountId: string;
  method: SessionMethod;
  authSessionId?: string | null;
}>): Promise<{ cookie: SessionCookie; sessionId: string } | null> {
  const opened = await sessionOpen({
    kind: "customer",
    method: input.method,
    accountId: input.accountId,
    ttlSeconds: CUSTOMER_SESSION_TTL_S,
    authSessionId: input.authSessionId ?? null,
  });
  if (!opened) return null;
  const value = issueSessionRefToken(opened.id, Date.parse(opened.expiresAt));
  if (!value) return null;
  const maxAge = Math.max(60, Math.floor((Date.parse(opened.expiresAt) - Date.now()) / 1000));
  return { cookie: { name: "rt", value, maxAge }, sessionId: opened.id };
}

/** The confirmed login, once per session id; never blocks the redirect. */
export function recordSessionLogin(input: Readonly<{
  accountId: string;
  sessionId: string;
  method: SessionMethod;
  admin?: boolean;
  next: string;
}>): Promise<unknown> {
  return recordAccountLogin(
    {
      accountId: input.accountId,
      kind: input.method,
      admin: input.admin === true,
      target: loginTargetOf(input.next),
      nonce: `sess-${input.sessionId}`,
    },
    { timeoutMs: 2_500 },
  );
}

export function cookieBase(requestUrl: string) {
  return {
    httpOnly: true,
    secure: new URL(requestUrl).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
  };
}
