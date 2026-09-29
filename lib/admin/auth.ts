import { adminOperatorByAccount, sessionMarkMfa, sessionOpen, type OperatorRow } from "@/lib/account/rpc";
import { appendAdminAudit } from "@/lib/admin/store";
import { ADMIN_IDLE_S, ADMIN_SESSION_TTL_S } from "@/lib/auth/account-session";
import { MFA_FRESH_S, mfaIsFresh, totpVerifiedAtMs } from "@/lib/admin/mfa-freshness";
import { supabaseServer, supabaseVerifiedUser, type SupabaseServerClient } from "@/lib/auth/supabase";
import { issueSessionRefToken } from "@/lib/beta/token";
import { getAdminSessionDetail, getSession, type AdminSessionDetail } from "@/lib/session";

export { MFA_FRESH_S, mfaIsFresh, totpVerifiedAtMs };

/**
 * The admin's own door, on the verified identity system.
 *
 * Daily path: email or Google through Supabase Auth, then the second factor
 * — a TOTP the owner enrols himself; the QR and secret go to the owner's
 * screen and authenticator and are never read, logged or stored here — then a
 * recorded privileged session (`rta`) with an absolute and an idle limit. The
 * second factor is asserted by Supabase: the identity session's assurance
 * level must be `aal2` before an admin session opens, and sensitive actions
 * ask for a fresh code when the last verification is older than
 * `MFA_FRESH_S`.
 *
 * The bot link (`/admin` in the bot) keeps working as the controlled
 * transitional path; it carries no second factor and is what the owner uses
 * to attach the new methods to his account the first time.
 */
export type AdminMfaState =
  | { status: "signed_out" }
  | { status: "no_account" }
  | { status: "not_operator"; accountId: string }
  | { status: "enrol"; accountId: string; operator: OperatorRow; authUserId: string }
  | { status: "verify"; accountId: string; operator: OperatorRow; authUserId: string; factorId: string; factors: readonly string[] }
  | { status: "ready"; accountId: string; operator: OperatorRow; authUserId: string; mfaAt: number | null; factors: readonly string[] }
  | { status: "unavailable" };

/** Where the person stands on the way to a privileged session. */
export async function adminMfaState(client: SupabaseServerClient): Promise<AdminMfaState> {
  const user = await supabaseVerifiedUser(client);
  if (!user) return { status: "signed_out" };
  const session = await getSession();
  const accountId = session?.accountId ?? null;
  if (!accountId || session?.account?.authUserId !== user.id) return { status: "no_account" };
  const operator = await adminOperatorByAccount(accountId);
  if (operator === undefined) return { status: "unavailable" };
  if (!operator || !operator.active) return { status: "not_operator", accountId };
  const { data: aal, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !aal) return { status: "unavailable" };

  const factors = await client.auth.mfa.listFactors();
  /* Only a factor Supabase has already verified can authenticate. An
     unverified one is a half-finished enrolment: challenging it completes the
     enrolment instead of proving anything, which is why it must never be
     offered as the way in. */
  const verified = (factors.data?.totp ?? []).filter((f) => f.status === "verified");
  const ids = verified.map((f) => f.id);

  if (aal.currentLevel === "aal2") {
    const mfaAt = totpVerifiedAtMs(aal.currentAuthenticationMethods as { method: string; timestamp: number }[] | undefined);
    return { status: "ready", accountId, operator, authUserId: user.id, mfaAt, factors: ids };
  }
  if (aal.nextLevel === "aal2" && verified.length) {
    return { status: "verify", accountId, operator, authUserId: user.id, factorId: verified[0].id, factors: ids };
  }
  return { status: "enrol", accountId, operator, authUserId: user.id };
}

/**
 * Open the recorded privileged session once the identity session is at aal2.
 *
 * `mfaFresh` decides whether the row is stamped as second-factor-verified now.
 * It is `true` only when the identity session's own TOTP authentication is
 * recent. Re-opening an admin session on an old `aal2` used to move
 * `mfa_verified_at` to the current time, which handed a browser left open for
 * hours the same standing as somebody who had just typed a code. Opening on a
 * stale factor is still allowed — the session simply starts unstamped and the
 * first sensitive action asks for a code.
 */
export async function openAdminSession(input: Readonly<{ accountId: string; method: "email_password" | "google_oidc" | "telegram_oidc"; authSessionId: string | null; mfaFresh: boolean }>): Promise<{ token: string; maxAge: number; sessionId: string } | null> {
  const opened = await sessionOpen({
    kind: "admin",
    method: input.method,
    accountId: input.accountId,
    ttlSeconds: ADMIN_SESSION_TTL_S,
    idleSeconds: ADMIN_IDLE_S,
    mfa: input.mfaFresh,
    authSessionId: input.authSessionId,
  });
  if (!opened) return null;
  const token = issueSessionRefToken(opened.id, Date.parse(opened.expiresAt), true);
  if (!token) return null;
  return { token, sessionId: opened.id, maxAge: Math.max(60, Math.floor((Date.parse(opened.expiresAt) - Date.now()) / 1000)) };
}

/**
 * The transitional Telegram admin path, and how it ends.
 *
 * The bot link is the door the owner has today; it carries no second factor,
 * so while it is open it is also an unconditional exemption from the fresh-code
 * rule. That exemption cannot be permanent — a path that stays open forever is
 * not transitional, it is the weakest door on the building. It closes by an
 * explicit owner decision rather than by a guess in code, because closing it
 * before the new login and its recovery are proven would lock the owner out of
 * the panel.
 *
 *   RYNTRA_ADMIN_BOT_PATH=open      (default) the bot link opens the admin and
 *                                   is exempt from the fresh-code rule; every
 *                                   use of the exemption is audited
 *   RYNTRA_ADMIN_BOT_PATH=mfa_only  the bot link still opens the admin, but
 *                                   sensitive actions need the new door
 *   RYNTRA_ADMIN_BOT_PATH=retired   the bot link is no longer an admin door
 *
 * The owner moves it one step at a time, after verifying the new login and a
 * second verified factor. The runbook names the criteria.
 */
export type BotPathPolicy = "open" | "mfa_only" | "retired";

export function adminBotPathPolicy(): BotPathPolicy {
  const raw = (process.env.RYNTRA_ADMIN_BOT_PATH ?? "").trim().toLowerCase();
  return raw === "retired" ? "retired" : raw === "mfa_only" ? "mfa_only" : "open";
}

export type FreshnessDecision =
  | { ok: true; admin: AdminSessionDetail; transitional?: true }
  | { ok: false; reason: "unauthorized" | "reverify" };

/**
 * Sensitive admin actions need a second factor verified within `MFA_FRESH_S`.
 * The transitional bot session has none; whether it is admitted anyway is the
 * policy above, and when it is, the caller is told so it can be recorded.
 */
export async function requireFreshMfa(): Promise<FreshnessDecision> {
  const admin = await getAdminSessionDetail();
  if (!admin) return { ok: false, reason: "unauthorized" };
  if (admin.method === "telegram_link") {
    const policy = adminBotPathPolicy();
    if (policy === "open") {
      /* The exemption leaves a trail. A path that skips the second factor
         without a record is indistinguishable, afterwards, from one that never
         skipped it — and the owner needs to be able to see how much of the
         panel's history went through the weaker door before deciding to close
         it. Recording must never block the action it records. */
      void appendAdminAudit({ actorTelegramId: admin.telegramId, action: "admin_mfa_bypass_transitional", outcome: "ok", reason: "bot_path_open" }).catch(() => undefined);
      return { ok: true, admin, transitional: true };
    }
    return { ok: false, reason: policy === "retired" ? "unauthorized" : "reverify" };
  }
  const verifiedAt = admin.mfaVerifiedAt ? Date.parse(admin.mfaVerifiedAt) : NaN;
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > MFA_FRESH_S * 1000) return { ok: false, reason: "reverify" };
  return { ok: true, admin };
}

/**
 * Re-verify: a fresh TOTP code, then the session row learns the time.
 *
 * The factor has to belong to the auth user this admin session was opened for.
 * Without that check a browser holding an admin session for one operator and
 * an identity session for another would refresh the first with the second's
 * authenticator — the whole point of the second factor, spent on the wrong
 * person.
 */
export async function reverifyAdminMfa(code: string, factorId?: string): Promise<"ok" | "invalid" | "unauthorized" | "mismatch" | "unavailable"> {
  const admin = await getAdminSessionDetail();
  if (!admin?.sessionId || admin.method === "telegram_link") return "unauthorized";
  const client = await supabaseServer();
  if (!client) return "unavailable";
  const user = await supabaseVerifiedUser(client);
  if (!user) return "unauthorized";
  if (!admin.authUserId || admin.authUserId !== user.id) return "mismatch";
  const factors = await client.auth.mfa.listFactors();
  const verified = (factors.data?.totp ?? []).filter((f) => f.status === "verified");
  const totp = factorId ? verified.find((f) => f.id === factorId) : verified[0];
  if (!totp) return factorId ? "mismatch" : "unavailable";
  const result = await client.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (result.error) return "invalid";
  const marked = await sessionMarkMfa(admin.sessionId);
  return marked ? "ok" : "unavailable";
}
