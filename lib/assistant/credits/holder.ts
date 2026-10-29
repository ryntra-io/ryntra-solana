/**
 * Whose credits a wallet spends (AI-04): the wallet's own until it is linked
 * to an account, then the account's — and at the first call after the link
 * the wallet's credits move into the account (`mergeHolders`), once.
 *
 * The link is read from the accounts store (`account_by_wallet`); when that
 * store does not answer, a wallet already merged keeps spending its account's
 * credits and any other wallet its own — never a second account and never a
 * refusal for a read that failed.
 */

import type { GuardStore } from "../../guard/store.ts";
import { accountHolder, mergeHolders, readBalance, walletHolder } from "./ledger.ts";

/** Which account proved this wallet: an id, `null` for none, `undefined` when the store did not answer. */
export type AccountLookup = (wallet: string) => Promise<string | null | undefined>;

/** `known` — the accounts store answered (a holder chosen without it is a fallback: no welcome is given on it). */
export type ResolvedHolder = Readonly<{ holder: string; wallet: string; accountId: string | null; merged: boolean; known: boolean }>;

const LOOKUP_MS = 1_500;

async function lookupBounded(lookup: AccountLookup, wallet: string): Promise<string | null | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([lookup(wallet), new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), LOOKUP_MS)))]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveHolder(store: GuardStore, wallet: string, lookup: AccountLookup | null, nowMs: number): Promise<ResolvedHolder> {
  const own = walletHolder(wallet);
  const found = lookup ? await lookupBounded(lookup, wallet) : null;
  const record = await readBalance(store, own).catch(() => null);
  if (found === undefined) {
    const into = record?.mergedInto ?? null;
    return into ? { holder: into, wallet, accountId: into.slice("account:".length), merged: false, known: false } : { holder: own, wallet, accountId: null, merged: false, known: false };
  }
  if (found === null) return { holder: own, wallet, accountId: null, merged: false, known: true };
  let account: string;
  try {
    account = accountHolder(found);
  } catch {
    return { holder: own, wallet, accountId: null, merged: false, known: false };
  }
  /* Credits on the wallet move whenever they are there — also ones that reached it after an earlier merge; the rest of its day moves once. */
  const somethingToMove = record !== null && (record.paid > 0 || record.bonus > 0 || (record.mergedInto !== account && (record.welcome || record.free.used > 0 || record.holds.length > 0)));
  if (!somethingToMove) return { holder: account, wallet, accountId: found.toLowerCase(), merged: false, known: true };
  const merged = await mergeHolders(store, own, account, nowMs);
  /* A wallet with an action still being answered keeps its own credits for this one call; the next call moves them. */
  if (!merged.ok) return { holder: own, wallet, accountId: null, merged: false, known: false };
  return { holder: account, wallet, accountId: found.toLowerCase(), merged: true, known: true };
}

/** The production lookup with a short in-process memory, so a conversation does not ask the accounts store every question. */
export function cachedLookup(lookup: AccountLookup, ttlMs = 60_000): AccountLookup {
  const seen = new Map<string, { value: string | null; until: number }>();
  return async (wallet) => {
    const now = Date.now();
    const hit = seen.get(wallet);
    if (hit && hit.until > now) return hit.value;
    const value = await lookup(wallet);
    if (value !== undefined) {
      if (seen.size > 5_000) seen.clear();
      seen.set(wallet, { value, until: now + ttlMs });
    }
    return value;
  };
}
