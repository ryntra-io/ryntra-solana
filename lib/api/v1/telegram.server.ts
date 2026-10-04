/**
 * The Telegram channel over the bearer — contract 1.11.0.
 *
 * The same channel Settings connects on ryntra.io
 * (`/api/account/notifications`): an account is the wallet that signed, and
 * Telegram is a place to be told something, never a way in. Settings reaches it
 * through the account's cookie session; a native client holds a wallet bearer
 * instead, so here the account is the one that owns the proven wallet.
 *
 * - Reading never creates anything: a wallet no account owns simply has no
 *   channel.
 * - Connecting resolves the wallet's account the way the web's sign-in does
 *   (`accountResolveSolana`, creating it on the first connect) — the bearer
 *   was opened by the wallet's own Sign In With Solana signature, which is
 *   the proof that call requires — and answers the bot link with the signed
 *   fifteen-minute code. The binding itself is still written only by the bot
 *   when the person presses Start in Telegram.
 * - Disconnecting removes the binding and nothing else.
 */

import type { GuardStore } from "../../guard/store.ts";
import {
  disconnectTelegramChannel,
  issueTelegramConnectCode,
  readTelegramChannel,
  TELEGRAM_CONNECT_TTL_MS,
  telegramChannelView,
  telegramConnectLink,
} from "../../account/notifications.ts";
import type { TelegramChannelResponse, TelegramConnectResponse } from "./contract.ts";

export type TelegramChannelDeps = Readonly<{
  store: GuardStore;
  /** The account that owns the wallet: its id, null when none does, undefined when the account store did not answer. */
  accountByWallet: (chain: "solana", address: string) => Promise<string | null | undefined>;
  /** The web's sign-in resolution: the wallet's account, created when absent. */
  accountResolveSolana: (address: string, language: "en" | "uk") => Promise<{ ok: true; accountId: string; isNew: boolean } | { ok: false; error: "bad_address" | "unavailable" }>;
  now?: () => number;
}>;

export type TelegramChannelOutcome<T> = Readonly<{ ok: true; body: T }> | Readonly<{ ok: false; code: "UNAVAILABLE"; message: string }>;

const STORE_SILENT = "The account store did not answer; nothing was changed.";

export async function readWalletTelegramChannel(address: string, deps: TelegramChannelDeps): Promise<TelegramChannelOutcome<TelegramChannelResponse>> {
  const accountId = await deps.accountByWallet("solana", address);
  if (accountId === undefined) return { ok: false, code: "UNAVAILABLE", message: STORE_SILENT };
  const channel = accountId === null ? null : await readTelegramChannel(deps.store, accountId);
  return { ok: true, body: { telegram: telegramChannelView(channel) } };
}

export async function connectWalletTelegramChannel(address: string, locale: "en" | "uk", deps: TelegramChannelDeps): Promise<TelegramChannelOutcome<TelegramConnectResponse>> {
  const account = await deps.accountResolveSolana(address, locale);
  if (!account.ok) return { ok: false, code: "UNAVAILABLE", message: STORE_SILENT };
  const now = (deps.now ?? Date.now)();
  const code = issueTelegramConnectCode(account.accountId, now);
  if (!code) return { ok: false, code: "UNAVAILABLE", message: "The connect code cannot be signed on this deployment." };
  /* The code carries its expiry in whole seconds; the answer states that same instant. */
  const expiresAt = new Date(Math.floor((now + TELEGRAM_CONNECT_TTL_MS) / 1000) * 1000).toISOString();
  return { ok: true, body: { link: telegramConnectLink(code), expiresAt } };
}

export async function disconnectWalletTelegramChannel(address: string, deps: TelegramChannelDeps): Promise<TelegramChannelOutcome<TelegramChannelResponse>> {
  const accountId = await deps.accountByWallet("solana", address);
  if (accountId === undefined) return { ok: false, code: "UNAVAILABLE", message: STORE_SILENT };
  if (accountId !== null && !(await disconnectTelegramChannel(deps.store, accountId))) return { ok: false, code: "UNAVAILABLE", message: STORE_SILENT };
  return { ok: true, body: { telegram: telegramChannelView(null) } };
}
