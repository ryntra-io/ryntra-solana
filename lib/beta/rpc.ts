import type { BetaState, TaskStatus, TaskType } from "./types";
import { rpcOrNull } from "../supabase-rpc";

// Server-only Supabase RPC client for the beta gate.
// Every beta_* function is SECURITY DEFINER and additionally gated by BETA_APP_SECRET,
// so a leaked anon key alone grants no access to user data.
// Transport lives in lib/supabase-rpc.ts (shared with paper/live; infra failures hit reportError).

const rpc = <T,>(fn: string, args: Record<string, unknown>) => rpcOrNull<T>("beta", fn, args);

/** Cheap liveness probe: true if the DB + RPC + secret path all work. Used by /api/health. */
export async function dbPing(): Promise<boolean> {
  return (await rpc<string>("health_ping", {})) === "ok";
}

/** Atomically marks a signed login JTI as spent. Null/false both fail closed at the exchange. */
export async function consumeLoginNonce(jti: string, expiresAt: number): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(jti) || !Number.isFinite(expiresAt)) return false;
  const consumed = await rpc<boolean>("beta_consume_login_nonce", {
    p_jti: jti,
    p_expires_at: new Date(expiresAt).toISOString(),
  });
  return consumed === true;
}

/**
 * Bind a proven wallet address to an account.
 *
 * The caller must already have verified an EIP-4361 signature over a
 * server-issued, single-use nonce — this function only records the result. The
 * database refuses an address another account already holds rather than moving
 * it, so a `wallet_taken` answer is a real conflict and never a retry.
 */
export async function linkVerifiedWallet(
  telegramId: number,
  wallet: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await rpc<{ ok: boolean; error?: string }>("beta_link_verified_wallet", {
    p_telegram_id: telegramId,
    p_wallet: wallet,
  });
  if (!result) return { ok: false, error: "unavailable" };
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? "failed" };
}

/**
 * Resolve an account from a proven wallet address.
 *
 * Returns identity only. Account state still comes from `getState`, so this can
 * never become a second and divergent view of a user.
 *
 * `telegramId` is nullable in the schema. It is `null` for an account created
 * without Telegram — representable since migration `20260812131229`, and not
 * yet creatable by anything, which is why the sign-in path treats a null as an
 * account it cannot serve rather than as an error.
 */
export async function userByWallet(
  wallet: string,
): Promise<{ ok: true; telegramId: number | null } | { ok: false; error: string }> {
  const result = await rpc<{ ok: boolean; error?: string; telegram_id?: number | null }>(
    "beta_user_by_wallet",
    { p_wallet: wallet },
  );
  if (!result) return { ok: false, error: "unavailable" };
  if (!result.ok) return { ok: false, error: result.error ?? "not_found" };
  return { ok: true, telegramId: result.telegram_id ?? null };
}

/**
 * Create an account from a proven wallet, or return the one that already holds
 * it.
 *
 * Sign-in is idempotent: a second click is not an error, so the database
 * returns the existing account rather than a unique violation the caller would
 * have to translate back into "you are already signed in".
 *
 * The proof happened in `app/api/auth/wallet` against a server-issued
 * single-use SIWE nonce. Nothing here verifies a signature, which is the same
 * division `linkVerifiedWallet` keeps.
 */
export async function createWalletUser(
  wallet: string,
): Promise<{ ok: true; state: BetaState; isNew: boolean } | { ok: false; error: string }> {
  const result = await rpc<BetaState & { ok?: boolean; error?: string; is_new?: boolean }>(
    "beta_create_wallet_user",
    { p_wallet: wallet },
  );
  if (!result) return { ok: false, error: "unavailable" };
  if (result.ok === false) return { ok: false, error: result.error ?? "failed" };
  return { ok: true, state: result as BetaState, isNew: result.is_new === true };
}

/**
 * Account state for a wallet.
 *
 * `getState` takes a Telegram id, which cannot serve an account whose Telegram
 * id is null. This is the same read through the same `beta_state_json`, entered
 * by the other key rather than by a second and divergent view.
 */
export function stateByWallet(wallet: string): Promise<BetaState | null> {
  return rpc<BetaState>("beta_state_by_wallet", { p_wallet: wallet });
}

export function upsertUser(p: {
  telegramId: number;
  username?: string;
  firstName?: string;
  language: string;
  inviterRef?: string | null;
}): Promise<BetaState | null> {
  return rpc<BetaState>("beta_upsert_user", {
    p_telegram_id: p.telegramId,
    p_username: p.username ?? "",
    p_first_name: p.firstName ?? "",
    p_language: p.language,
    p_inviter_ref: p.inviterRef ?? null,
  });
}

export function setTask(
  telegramId: number,
  task: TaskType,
  status: TaskStatus,
  metadata?: Record<string, unknown>
): Promise<BetaState | null> {
  return rpc<BetaState>("beta_set_task", {
    p_telegram_id: telegramId,
    p_task: task,
    p_status: status,
    p_metadata: metadata ?? null,
  });
}

export function setWallet(telegramId: number, wallet: string): Promise<BetaState | null> {
  return rpc<BetaState>("beta_set_wallet", { p_telegram_id: telegramId, p_wallet: wallet });
}

export function getState(telegramId: number): Promise<BetaState | null> {
  return rpc<BetaState>("beta_get_state", { p_telegram_id: telegramId });
}

/** True = first time this update_id is seen; false = duplicate delivery. */
export async function markUpdate(updateId: number): Promise<boolean> {
  const r = await rpc<boolean>("beta_mark_update", { p_update_id: updateId });
  // On RPC failure prefer processing over dropping (Telegram retries are rare).
  return r !== false;
}

export function metrics(): Promise<Record<string, unknown> | null> {
  return rpc<Record<string, unknown>>("beta_metrics", {});
}
