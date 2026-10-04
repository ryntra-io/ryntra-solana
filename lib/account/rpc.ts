/**
 * Server-only wrappers for the account, session, wallet-link and
 * receipts-archive RPCs (migration `20260906120000_ryn_access_002_accounts_v1`).
 *
 * Every function here is a SECURITY DEFINER RPC gated by the app secret, so
 * this module — like `lib/beta/rpc.ts` — never runs in the browser. Failures
 * come back as values, never as thrown errors: a session store that cannot be
 * reached is a signed-out user, not a crashed page.
 */
import { rpcResult } from "../supabase-rpc";

const rpc = <T,>(fn: string, args: Record<string, unknown>) => rpcResult<T>("account", fn, args);

export const SESSION_KINDS = ["customer", "wallet", "admin"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_METHODS = [
  "telegram_link",
  "wallet_siwe",
  "email_password",
  "email_recovery",
  "google_oidc",
  "telegram_oidc",
  "solana_siws",
] as const;
export type SessionMethod = (typeof SESSION_METHODS)[number];

export const WALLET_CHAINS = ["solana", "evm"] as const;
export type WalletChain = (typeof WALLET_CHAINS)[number];

export type WalletLink = Readonly<{ chain: WalletChain; address: string; verifiedAt: string }>;

export type ResolvedSession = Readonly<{
  id: string;
  kind: SessionKind;
  method: SessionMethod;
  accountId: string | null;
  walletChain: WalletChain | null;
  walletAddress: string | null;
  authSessionId: string | null;
  issuedAt: string;
  expiresAt: string;
  mfaVerifiedAt: string | null;
  /** The account's state projection (`beta_state_json`), null for wallet sessions. */
  state: unknown;
  account: Readonly<{
    authUserId: string | null;
    telegramLinked: boolean;
    operator: boolean;
    wallets: readonly WalletLink[];
  }> | null;
}>;

export type SessionResolveOutcome =
  | { status: "ok"; session: ResolvedSession }
  | { status: "refused"; reason: "not_found" | "revoked" | "expired" | "idle" }
  | { status: "unavailable" };

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseWallets(value: unknown): WalletLink[] {
  if (!Array.isArray(value)) return [];
  const out: WalletLink[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const chain = row.chain === "solana" || row.chain === "evm" ? row.chain : null;
    const address = str(row.address);
    const verifiedAt = str(row.verified_at);
    if (chain && address && verifiedAt) out.push({ chain, address, verifiedAt });
  }
  return out;
}

export function parseResolvedSession(raw: unknown): ResolvedSession | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Raw;
  if (row.ok !== true) return null;
  const id = str(row.id);
  const kind = SESSION_KINDS.find((k) => k === row.kind) ?? null;
  const method = SESSION_METHODS.find((m) => m === row.method) ?? null;
  const issuedAt = str(row.issued_at);
  const expiresAt = str(row.expires_at);
  if (!id || !kind || !method || !issuedAt || !expiresAt) return null;
  const accountRaw = row.account && typeof row.account === "object" ? (row.account as Raw) : null;
  return {
    id,
    kind,
    method,
    accountId: str(row.account_id),
    walletChain: row.wallet_chain === "solana" || row.wallet_chain === "evm" ? row.wallet_chain : null,
    walletAddress: str(row.wallet_address),
    authSessionId: str(row.auth_session_id),
    issuedAt,
    expiresAt,
    mfaVerifiedAt: str(row.mfa_verified_at),
    state: row.state ?? null,
    account: accountRaw
      ? {
          authUserId: str(accountRaw.auth_user_id),
          telegramLinked: accountRaw.telegram_linked === true,
          operator: accountRaw.operator === true,
          wallets: parseWallets(accountRaw.wallets),
        }
      : null,
  };
}

export async function sessionOpen(input: Readonly<{
  kind: SessionKind;
  method: SessionMethod;
  accountId?: string | null;
  ttlSeconds: number;
  idleSeconds?: number | null;
  walletChain?: WalletChain | null;
  walletAddress?: string | null;
  mfa?: boolean;
  authSessionId?: string | null;
}>): Promise<{ id: string; expiresAt: string } | null> {
  const r = await rpc<Raw>("session_open", {
    p_kind: input.kind,
    p_method: input.method,
    p_account_id: input.accountId ?? null,
    p_ttl_seconds: input.ttlSeconds,
    p_idle_seconds: input.idleSeconds ?? null,
    p_wallet_chain: input.walletChain ?? null,
    p_wallet_address: input.walletAddress ?? null,
    p_mfa: input.mfa === true,
    p_auth_session_id: input.authSessionId ?? null,
  });
  if (!r.ok || r.data.ok !== true) return null;
  const id = str(r.data.id);
  const expiresAt = str(r.data.expires_at);
  return id && expiresAt ? { id, expiresAt } : null;
}

export async function sessionResolve(id: string, touch = true): Promise<SessionResolveOutcome> {
  const r = await rpc<Raw>("session_resolve", { p_id: id, p_touch: touch });
  if (!r.ok) return { status: "unavailable" };
  if (r.data.ok === true) {
    const session = parseResolvedSession(r.data);
    return session ? { status: "ok", session } : { status: "unavailable" };
  }
  const error = r.data.error;
  if (error === "not_found" || error === "revoked" || error === "expired" || error === "idle") {
    return { status: "refused", reason: error };
  }
  return { status: "unavailable" };
}

export type RevokeReason = "logout" | "logout_all" | "password_reset" | "role_revoked" | "replaced";

export async function sessionRevoke(id: string, reason: RevokeReason = "logout"): Promise<boolean> {
  const r = await rpc<Raw>("session_revoke", { p_id: id, p_reason: reason });
  return r.ok && r.data.ok === true;
}

export async function sessionRevokeAccount(input: Readonly<{
  accountId: string;
  keep?: string | null;
  reason?: RevokeReason;
  kind?: SessionKind | null;
}>): Promise<number | null> {
  const r = await rpc<Raw>("session_revoke_account", {
    p_account_id: input.accountId,
    p_keep: input.keep ?? null,
    p_reason: input.reason ?? "logout_all",
    p_kind: input.kind ?? null,
  });
  if (!r.ok || r.data.ok !== true) return null;
  return typeof r.data.revoked === "number" ? r.data.revoked : 0;
}

/**
 * Close legacy access for one account.
 *
 * A stateless pre-migration cookie carries no session id, so `session_revoke`
 * has nothing to revoke and deleting the browser's copy leaves every other
 * copy working. This marks the account instead, and `getSession` refuses a
 * stateless token for a marked account. Scoped to one account: no secret is
 * rotated and nobody else is signed out.
 *
 * Four honest answers, and the caller must keep them apart:
 *
 *   `closed`        the cutoff is set; remaining stateless cookies are dead;
 *   `not_found`     no such account;
 *   `not_deployed`  the database does not carry this RPC yet, so there is
 *                   nothing to call — the same position every deployment was
 *                   in before the cutoff existed, and not a store failure;
 *   `unavailable`   the store did not answer, which is never a revocation.
 */
export type LegacyCloseResult = "closed" | "not_found" | "not_deployed" | "unavailable";

export async function accountLegacyClose(accountId: string, reason: RevokeReason = "logout_all"): Promise<LegacyCloseResult> {
  const r = await rpc<Raw>("account_legacy_close", { p_account_id: accountId, p_reason: reason });
  if (!r.ok) return /could not find the function|pgrst202|does not exist/i.test(r.error) ? "not_deployed" : "unavailable";
  if (r.data.ok !== true) return "not_found";
  return r.data.closed === true ? "closed" : "not_found";
}

export async function sessionMarkMfa(id: string): Promise<boolean> {
  const r = await rpc<Raw>("session_mark_mfa", { p_id: id });
  return r.ok && r.data.ok === true;
}

export type SessionListRow = Readonly<{
  id: string;
  kind: SessionKind;
  method: SessionMethod;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  mfaVerifiedAt: string | null;
}>;

export async function sessionList(accountId: string): Promise<SessionListRow[] | null> {
  const r = await rpc<Raw>("session_list", { p_account_id: accountId });
  if (!r.ok || r.data.ok !== true || !Array.isArray(r.data.rows)) return null;
  const rows: SessionListRow[] = [];
  for (const entry of r.data.rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const id = str(row.id);
    const kind = SESSION_KINDS.find((k) => k === row.kind) ?? null;
    const method = SESSION_METHODS.find((m) => m === row.method) ?? null;
    const issuedAt = str(row.issued_at);
    const lastSeenAt = str(row.last_seen_at);
    const expiresAt = str(row.expires_at);
    if (id && kind && method && issuedAt && lastSeenAt && expiresAt) {
      rows.push({ id, kind, method, issuedAt, lastSeenAt, expiresAt, mfaVerifiedAt: str(row.mfa_verified_at) });
    }
  }
  return rows;
}

export type AccountResolveResult =
  | { ok: true; accountId: string; isNew: boolean; linkedLegacy: boolean }
  | { ok: false; error: "telegram_claimed" | "bad_auth_user" | "unavailable" | "account_bound" | "auth_user_claimed" };

/** The account behind a Supabase Auth user — found, bound to a legacy row, or created. */
export async function accountResolveAuth(input: Readonly<{
  authUserId: string;
  telegramId?: number | null;
  displayName?: string | null;
  language?: string | null;
}>): Promise<AccountResolveResult> {
  const r = await rpc<Raw>("account_resolve_auth", {
    p_auth_user_id: input.authUserId,
    p_telegram_id: input.telegramId ?? null,
    p_display_name: input.displayName ?? null,
    p_language: input.language ?? null,
  });
  if (!r.ok) return { ok: false, error: "unavailable" };
  if (r.data.ok === true) {
    const accountId = str(r.data.account_id);
    if (!accountId) return { ok: false, error: "unavailable" };
    return { ok: true, accountId, isNew: r.data.is_new === true, linkedLegacy: r.data.linked_legacy === true };
  }
  return { ok: false, error: r.data.error === "telegram_claimed" ? "telegram_claimed" : "bad_auth_user" };
}

/** The account an auth user is bound to; `null` means none, `undefined` means the store did not answer. */
export async function accountByAuthUser(authUserId: string): Promise<string | null | undefined> {
  const r = await rpc<Raw>("account_by_auth_user", { p_auth_user_id: authUserId });
  if (!r.ok || r.data.ok !== true) return undefined;
  return str(r.data.account_id);
}

export type AccountBindResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "account_bound" | "auth_user_claimed" | "unavailable" };

export async function accountBindAuth(accountId: string, authUserId: string): Promise<AccountBindResult> {
  const r = await rpc<Raw>("account_bind_auth", { p_account_id: accountId, p_auth_user_id: authUserId });
  if (!r.ok) return { ok: false, error: "unavailable" };
  if (r.data.ok === true) return { ok: true };
  const error = r.data.error;
  return {
    ok: false,
    error: error === "not_found" || error === "account_bound" || error === "auth_user_claimed" ? error : "unavailable",
  };
}

export type WalletLinkResult =
  | { ok: true; already: boolean }
  | { ok: false; error: "bad_chain" | "bad_address" | "not_found" | "wallet_taken" | "unavailable" };

export async function accountWalletLink(accountId: string, chain: WalletChain, address: string): Promise<WalletLinkResult> {
  const r = await rpc<Raw>("account_wallet_link", { p_account_id: accountId, p_chain: chain, p_address: address });
  if (!r.ok) return { ok: false, error: "unavailable" };
  if (r.data.ok === true) return { ok: true, already: r.data.already === true };
  const error = r.data.error;
  return {
    ok: false,
    error:
      error === "bad_chain" || error === "bad_address" || error === "not_found" || error === "wallet_taken"
        ? error
        : "unavailable",
  };
}

export async function accountWalletUnlink(accountId: string, chain: WalletChain, address: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await rpc<Raw>("account_wallet_unlink", { p_account_id: accountId, p_chain: chain, p_address: address });
  if (!r.ok) return { ok: false, error: "unavailable" };
  return r.data.ok === true ? { ok: true } : { ok: false, error: str(r.data.error) ?? "unavailable" };
}

/** Which account proved this address; `null` means nobody, `undefined` means the store did not answer. */
export async function accountByWallet(chain: WalletChain, address: string): Promise<string | null | undefined> {
  const r = await rpc<Raw>("account_by_wallet", { p_chain: chain, p_address: address });
  if (!r.ok || r.data.ok !== true) return undefined;
  return str(r.data.account_id);
}

/** Only call after verified, purpose-bound SIWS; a missing migration fails closed. */
export async function accountResolveSolana(address: string, language: "en" | "uk"): Promise<
  { ok: true; accountId: string; isNew: boolean } | { ok: false; error: "bad_address" | "unavailable" }
> {
  const r = await rpc<Raw>("account_resolve_solana", { p_address: address, p_language: language });
  if (!r.ok) return { ok: false, error: "unavailable" };
  const accountId = str(r.data.account_id);
  if (r.data.ok === true && accountId) return { ok: true, accountId, isNew: r.data.is_new === true };
  return { ok: false, error: r.data.error === "bad_address" ? "bad_address" : "unavailable" };
}

export type ArchivedReceipt = Readonly<{
  kind: "send" | "swap" | "bridge" | "receive" | "other";
  contentHash: string;
  payload: Record<string, unknown>;
  occurredAt: string | null;
  createdAt: string;
}>;

export async function walletReceiptsPut(
  chain: WalletChain,
  address: string,
  rows: readonly Readonly<{ kind: ArchivedReceipt["kind"]; contentHash: string; payload: Record<string, unknown>; occurredAt?: string | null }>[],
): Promise<number | null> {
  const r = await rpc<Raw>("wallet_receipts_put", {
    p_chain: chain,
    p_address: address,
    p_rows: rows.map((row) => ({
      kind: row.kind,
      content_hash: row.contentHash,
      payload: row.payload,
      occurred_at: row.occurredAt ?? null,
    })),
  });
  if (!r.ok || r.data.ok !== true) return null;
  return typeof r.data.inserted === "number" ? r.data.inserted : 0;
}

export async function walletReceiptsList(chain: WalletChain, address: string, limit = 100): Promise<ArchivedReceipt[] | null> {
  const r = await rpc<Raw>("wallet_receipts_list", { p_chain: chain, p_address: address, p_limit: limit });
  if (!r.ok || r.data.ok !== true || !Array.isArray(r.data.rows)) return null;
  const out: ArchivedReceipt[] = [];
  for (const entry of r.data.rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const kind = row.kind;
    const contentHash = str(row.content_hash);
    const createdAt = str(row.created_at);
    if (
      (kind === "send" || kind === "swap" || kind === "bridge" || kind === "receive" || kind === "other") &&
      contentHash &&
      createdAt &&
      row.payload &&
      typeof row.payload === "object"
    ) {
      out.push({ kind, contentHash, payload: row.payload as Record<string, unknown>, occurredAt: str(row.occurred_at), createdAt });
    }
  }
  return out;
}

export type OperatorRow = Readonly<{ telegramId: number; role: string; active: boolean; displayName: string | null }>;

/** The operator row behind an account, or `null`; `undefined` when the store did not answer. */
export async function adminOperatorByAccount(accountId: string): Promise<OperatorRow | null | undefined> {
  const r = await rpc<Raw>("admin_operator_by_account", { p_account_id: accountId });
  if (!r.ok || r.data.ok !== true) return undefined;
  const op = r.data.operator;
  if (!op || typeof op !== "object") return null;
  const row = op as Raw;
  const telegramId = typeof row.telegram_id === "number" ? row.telegram_id : Number(row.telegram_id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null;
  return {
    telegramId,
    role: str(row.role) ?? "OWNER",
    active: row.active === true,
    displayName: str(row.display_name),
  };
}
