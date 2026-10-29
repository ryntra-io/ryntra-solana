import { cookies } from "next/headers";
import { verifySession } from "@/lib/beta/token";
import { getState, stateByWallet } from "@/lib/beta/rpc";
import { legacyAccessClosed } from "@/lib/beta/legacy-access";
import type { BetaState } from "@/lib/beta/types";
import { isAdminOperator } from "@/lib/admin/store";
import { projectSessionIdentity } from "@/lib/home/session-identity";
import { sessionResolve, type ResolvedSession, type SessionMethod, type WalletLink } from "@/lib/account/rpc";
import type { AccountSubject } from "@/lib/account/subject";
import { LINKED_WALLET_COOKIE, readCookieWalletProof, walletSessionBound, type WalletProof, type WalletProofRead } from "@/lib/account/wallet-session";
import { bearerToken, resolveNativeSession } from "@/lib/auth/native-session";

/**
 * The cabinet session.
 *
 * **`telegramId` is nullable.** An account can now be reached by a wallet
 * alone, so the identifier a caller needs may not exist. Every site that passes
 * a Telegram id to an RPC has to decide what a wallet account does instead,
 * and the type is what makes them decide rather than assume.
 *
 * **`accountId` is the account.** It is the uuid of the `beta_users` row every
 * identity — Telegram bot, Supabase Auth user, proven wallet — resolves to,
 * and the key every account-bound RPC prefers. It is `null` only for a legacy
 * stateless session read before the migration that projects it, which keeps
 * working through the Telegram path.
 *
 * **`verified` did not change meaning.** It is still the Telegram channel join.
 * It gates the one surface that provisions a trading credential
 * (`/app/connect`); saving plans, notes and settings needs an account, not a
 * channel membership.
 *
 * **`sessionId` names the recorded row** for sessions minted after the account
 * migration — the ones that can be revoked — and is `null` for a legacy
 * stateless token, which lives until its own expiry and no longer.
 */
export type SessionAccount = Readonly<{
  authUserId: string | null;
  telegramLinked: boolean;
  operator: boolean;
  wallets: readonly WalletLink[];
}>;

type SessionCommon = Readonly<{
  expiresAt?: string | null;
  accountId: string | null;
  sessionId: string | null;
  method: SessionMethod | null;
  account: SessionAccount | null;
  state: BetaState;
}>;

export type Session =
  /** An account that has a Telegram id — reached by any door. */
  | (SessionCommon &
      Readonly<{
        telegramId: number;
        /** Which signed subject minted this session. */
        subjectKind: "TELEGRAM" | "WALLET" | "ACCOUNT";
        /** Present only when SIWE itself minted this session. */
        identityWallet: string | null;
        verified: boolean;
      }>)
  /**
   * An account without a Telegram id: a wallet-only legacy row or an account
   * created through email, Google or Telegram OpenID Connect that never used
   * the bot. `verified` is `false` here as a type, not as a runtime
   * coincidence: the channel join cannot be verified for an account that has
   * no Telegram id, so every Telegram-keyed surface returns early on
   * `!verified` and the compiler knows the id exists after that check.
   */
  | (SessionCommon &
      Readonly<{
        telegramId: null;
        subjectKind: "WALLET" | "ACCOUNT";
        identityWallet: string | null;
        verified: false;
      }>);

/** True when this session can reach the RPCs that still key on a Telegram id. */
export function hasTelegramId(s: Session): s is Extract<Session, { telegramId: number }> {
  return s.telegramId !== null;
}

/** The actor an account-bound RPC acts for. */
export function subjectOf(s: Session): AccountSubject {
  return { accountId: s.accountId, telegramId: s.telegramId };
}

/**
 * True when the session may keep personal data: any recorded account session,
 * or a legacy session that either knows its account or passed the old
 * channel-join gate. A legacy unverified bot session before the migration
 * keeps the refusal it always had.
 */
export function canKeepPersonalData(s: Session): boolean {
  return s.accountId !== null || s.verified;
}

function accountIdOf(state: BetaState): string | null {
  const id = state.user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function isBetaState(value: unknown): value is BetaState {
  return Boolean(value && typeof value === "object" && (value as { user?: unknown }).user && typeof (value as { user: unknown }).user === "object");
}

function fromRecorded(resolved: ResolvedSession): Session | null {
  if (!walletSessionBound(resolved) || !resolved.accountId || !isBetaState(resolved.state)) return null;
  const state = resolved.state;
  const joined = state.tasks?.telegram_join?.status === "verified";
  const account: SessionAccount = resolved.account ?? { authUserId: null, telegramLinked: false, operator: false, wallets: [] };
  const common = { accountId: resolved.accountId, sessionId: resolved.id, method: resolved.method, expiresAt: resolved.expiresAt, account, state };
  const telegramId = state.user.telegram_id;
  if (telegramId === null) {
    return { ...common, telegramId: null, subjectKind: resolved.method === "solana_siws" ? "WALLET" : "ACCOUNT", identityWallet: resolved.walletAddress, verified: false };
  }
  return {
    ...common,
    telegramId,
    subjectKind: resolved.method === "telegram_link" ? "TELEGRAM" : "ACCOUNT",
    identityWallet: resolved.walletAddress,
    verified: joined,
  };
}

/**
 * The cabinet session with the one fact `getSession` folds away: whether the
 * store answered. `unavailable` is a signed cookie the store could not read
 * right now — not a signed-out person. The account surfaces say «checking»
 * for it and never sign anybody out because of it.
 */
export type SessionRead =
  | Readonly<{ status: "ok"; session: Session }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "unavailable" }>;

export async function readSession(): Promise<SessionRead> {
  const jar = await cookies();
  const token = jar.get("rt")?.value ?? "";
  const parsed = verifySession(token);
  if (!parsed) return { status: "absent" };
  if (parsed.subject.kind === "session") {
    const outcome = await sessionResolve(parsed.subject.sessionId);
    if (outcome.status === "unavailable") return { status: "unavailable" };
    const session = outcome.status === "ok" ? fromRecorded(outcome.session) : null;
    return session ? { status: "ok", session } : { status: "absent" };
  }
  const session = await getSession();
  return session ? { status: "ok", session } : { status: "absent" };
}

/** Resolve the cabinet session exclusively from the HttpOnly `rt` cookie. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get("rt")?.value ?? "";
  const parsed = verifySession(token);
  if (!parsed) return null;

  /* A recorded session is the row's word, live: revoked, idle or expired rows
     refuse here and nothing is read from a cached copy. A store that does not
     answer grants nothing here; `readSession` is how a caller tells that apart
     from a signed-out request. */
  if (parsed.subject.kind === "session") {
    const outcome = await sessionResolve(parsed.subject.sessionId);
    return outcome.status === "ok" ? fromRecorded(outcome.session) : null;
  }

  /* Two keys, one read. The state comes from `beta_state_json` either way —
     `stateByWallet` is the same function entered by the other identifier, not a
     second view of an account. */
  const state =
    parsed.subject.kind === "telegram"
      ? await getState(parsed.subject.telegramId)
      : await stateByWallet(parsed.subject.wallet);
  if (!state) return null;

  /* A stateless token has no row to revoke, so «вийти всюди» and a password
     reset close legacy access for the account instead, and every remaining
     copy of the old cookie stops here. The next bot link mints a recorded
     session, which can be revoked one at a time. */
  if (legacyAccessClosed(state.user)) return null;

  const joined = state.tasks?.telegram_join?.status === "verified";
  const identity = projectSessionIdentity({
    subjectKind: parsed.subject.kind === "telegram" ? "TELEGRAM" : "WALLET",
    subjectWallet: parsed.subject.kind === "wallet" ? parsed.subject.wallet : null,
    watchAddress: state.user.wallet_address,
  });
  const common = { accountId: accountIdOf(state), sessionId: null, method: null, account: null, state };

  if (parsed.subject.kind === "telegram") {
    return {
      ...common,
      telegramId: parsed.subject.telegramId,
      subjectKind: identity.subjectKind,
      identityWallet: identity.identityWallet,
      verified: joined,
    };
  }

  /* One account, two keys. Somebody who joined by Telegram, linked an address
     and now signs in with that address lands on the same row, so the Telegram
     id is read back off the account rather than dropped because of which door
     was used. Dropping it would have quietly made one person two accounts —
     and would have shown them an empty journal while their own trades sat in
     the row they had just authenticated against. */
  const wallet = parsed.subject.wallet;
  const linked = state.user.telegram_id;
  if (linked === null) {
    return { ...common, telegramId: null, subjectKind: "WALLET", identityWallet: wallet, verified: false };
  }
  return { ...common, telegramId: linked, subjectKind: "WALLET", identityWallet: wallet, verified: joined };
}

/**
 * A proven wallet: the `rw` cookie, the wallet sign-in itself, or a wallet
 * linked to the account signed in.
 *
 * Proof always rests on a signature by that address over a message this
 * server built and verified. Three carriers exist: the `rw` proof (`prove`,
 * for the API; short), the customer session a wallet sign-in opens (`rt`,
 * method `solana_siws`), which names the address it signed with, and — of 20.10 (decision 62, SOL-W3) — an account session opened
 * by another door (email, Google, Telegram), which proves the Solana wallets
 * its account linked by that wallet's signature (`action=link`), read live from
 * the session's row (`sessionWalletProof`). So one signature is the proof for
 * every private read — nobody signs again to see their own data. That third
 * carrier counts only for a caller that reads and opts in (`allowLink`): a
 * write, a payout or a binding never sees it and asks the wallet's own
 * signature, as before. No proof signs for the wallet — a trade or a transfer
 * of the wallet's money is signed by the wallet at the moment of action. A
 * connected wallet in the browser proves nothing and never reaches here. The
 * rule itself lives in `readCookieWalletProof`, where node tests it.
 */
export type { WalletProof, WalletProofRead } from "@/lib/account/wallet-session";

/**
 * `allowLink`: whether an account session's linked wallet counts (`via:
 * "link"`). Off by default — a link proves a wallet for reading only, so a caller that writes, pays or binds anything
 * never sees it and answers «sign with the wallet» as before; a read opts in.
 */
export type WalletProofOptions = Readonly<{ allowLink?: boolean }>;

export async function readWalletProof(options: WalletProofOptions = {}): Promise<WalletProofRead> {
  const jar = await cookies();
  return readCookieWalletProof(
    { rw: jar.get("rw")?.value ?? null, rt: jar.get("rt")?.value ?? null, linked: jar.get(LINKED_WALLET_COOKIE)?.value ?? null },
    { verify: verifySession, resolve: (id) => sessionResolve(id) },
    options,
  );
}

/**
 * Thrown by `getWalletProof` when the store could not answer. A missing proof
 * is a 401 the person can fix by signing; a store that blinked is not, and
 * reading it as «not proven» asked people to sign again for nothing. A route
 * that wants to say 503 reads `readWalletProof(From)` instead.
 */
export class SessionStoreUnavailable extends Error {
  constructor() {
    super("session store unavailable");
    this.name = "SessionStoreUnavailable";
  }
}

export async function getWalletProof(options: WalletProofOptions = {}): Promise<WalletProof | null> {
  const read = await readWalletProof(options);
  if (read.status === "unavailable") throw new SessionStoreUnavailable();
  return read.status === "ok" ? read.proof : null;
}

/**
 * A proven wallet from whichever carrier the request uses: the native bearer
 * (`Authorization: Bearer …`, per the API contract) or the web's cookies.
 *
 * A bearer that is present and fails is a refusal — it never falls through to
 * the cookie, so a native client cannot be quietly served a browser's session
 * and a browser cannot be served a native one.
 */
export async function readWalletProofFrom(headers: Headers, options: WalletProofOptions = {}): Promise<WalletProofRead> {
  if (bearerToken(headers)) {
    const read = await resolveNativeSession(headers);
    if (!read.ok) return read.code === "UNAVAILABLE" ? { status: "unavailable" } : { status: "absent" };
    return { status: "ok", proof: { sessionId: read.session.sessionId, chain: "solana", address: read.session.address, method: read.resolved.method, expiresAt: read.session.expiresAt, via: "signin" } };
  }
  return readWalletProof(options);
}

export async function getWalletProofFrom(headers: Headers, options: WalletProofOptions = {}): Promise<WalletProof | null> {
  const read = await readWalletProofFrom(headers, options);
  if (read.status === "unavailable") throw new SessionStoreUnavailable();
  return read.status === "ok" ? read.proof : null;
}

/** Admin session from the `rta` cookie. Returns the admin's telegram id or null. */
export async function getAdminSession(): Promise<number | null> {
  const detail = await getAdminSessionDetail();
  return detail ? detail.telegramId : null;
}

/**
 * The privileged session in full: who, through which door, and when the
 * second factor was last verified. `sessionId` is `null` for the transitional
 * bot-link admin session, which has no row and no second factor.
 */
export type AdminSessionDetail = Readonly<{
  telegramId: number;
  accountId: string | null;
  /**
   * The auth user this privileged session belongs to. Re-verification has to
   * check a factor of *this* user: a browser can hold an admin session for one
   * account and an identity session for another, and a second factor proves
   * only who owns the factor.
   */
  authUserId: string | null;
  sessionId: string | null;
  method: SessionMethod | null;
  mfaVerifiedAt: string | null;
}>;

export async function getAdminSessionDetail(): Promise<AdminSessionDetail | null> {
  const jar = await cookies();
  const token = jar.get("rta")?.value ?? "";
  const parsed = verifySession(token);
  /* A recorded admin session: the row says whether it is still live and the
     operator flag is read from `admin_operators` at resolve time, so a revoked
     role or a revoked session refuses on the next request. */
  if (parsed?.admin && parsed.subject.kind === "session") {
    const outcome = await sessionResolve(parsed.subject.sessionId);
    if (outcome.status !== "ok") return null;
    const s = outcome.session;
    if (s.kind !== "admin" || !s.accountId || !s.account?.operator || !isBetaState(s.state)) return null;
    const telegramId = s.state.user.telegram_id;
    if (telegramId === null) return null;
    return { telegramId, accountId: s.accountId, authUserId: s.account.authUserId, sessionId: s.id, method: s.method, mfaVerifiedAt: s.mfaVerifiedAt };
  }
  /* `parse` already refuses an admin payload with a wallet subject — there is
     no wallet admin path — so this narrowing is the type catching up with a
     rule the token layer enforces rather than a second check. */
  if (!parsed?.admin || parsed.subject.kind !== "telegram") return null;
  const telegramId = parsed.subject.telegramId;
  const operator = (await isAdminOperator(telegramId)) ? telegramId : null;
  if (operator === null) return null;
  return { telegramId: operator, accountId: null, authUserId: null, sessionId: null, method: "telegram_link", mfaVerifiedAt: null };
}
