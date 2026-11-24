'use client';

import { useSyncExternalStore } from 'react';
import { useProPier } from '../../city/lib/earn/pro-store.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import { isProLedger, ledgerAfter, ledgerOfOpen, type ProLanded, type ProLedger } from '../../lib/portfolio/pool-result.ts';

/**
 * What the person's device keeps of their DLMM Pro positions opened here (`lib/portfolio/pool-result.ts`): the chain
 * keeps no record of what went in, so the result against holding is counted from the opening this device saw. Each
 * landed action of a position — read from the Review the person signed — moves its entry; nothing here signs or sends.
 *
 * Every read and write is in try/catch: a private window or blocked site data gives no entry, and the screen then says
 * the result is not known — never a guess.
 */

const KEY = 'ryntra.earn.pro.ledger.v1:';
/** The most positions a wallet keeps on the device. */
const MOST = 48;

let version = 0;
const listeners = new Set<() => void>();
const told = () => {
  version += 1;
  for (const listen of listeners) listen();
};

function readAll(owner: string): Record<string, ProLedger> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY + owner) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, ProLedger> = {};
    for (const [mint, value] of Object.entries(raw as Record<string, unknown>)) if (isProLedger(value) && value.nftMint === mint) out[mint] = value;
    return out;
  } catch {
    return {};
  }
}

function writeOne(owner: string, nftMint: string, ledger: ProLedger | null): void {
  try {
    const all = readAll(owner);
    if (ledger) all[nftMint] = ledger;
    else delete all[nftMint];
    const kept = Object.values(all)
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, MOST);
    window.localStorage.setItem(KEY + owner, JSON.stringify(Object.fromEntries(kept.map((entry) => [entry.nftMint, entry]))));
  } catch {
    // Without storage the result is simply not known on the next visit.
  }
  told();
}

/** The entries of a wallet's positions, by the position's NFT. */
export function ledgersOf(owner: string | null): ReadonlyMap<string, ProLedger> {
  if (!owner || typeof window === 'undefined') return new Map();
  return new Map(Object.entries(readAll(owner)));
}

const subscribe = (listen: () => void) => {
  listeners.add(listen);
  return () => listeners.delete(listen);
};
const snapshot = () => version;

/** The store's turn: a screen reads `ledgersOf` again when it changes. */
export const useLedgerTurn = (): number => useSyncExternalStore(subscribe, snapshot, () => 0);

/** What a landed Review's summary says, as the entry reads it; null for one it does not count. */
function landedOf(summary: unknown): ProLanded | null {
  if (!summary || typeof summary !== 'object') return null;
  const action = (summary as { action?: unknown }).action;
  return action === 'open' || action === 'compound' || action === 'collect' || action === 'leave' || action === 'close' || action === 'care_on' || action === 'care_off' ? (summary as ProLanded) : null;
}

let watching = false;

/**
 * Starts keeping the entries: once per page, from the first screen that shows a DLMM Pro position or opens one. An
 * opening counts only where every transaction landed; an action after it that landed in part leaves its entry unknown.
 */
export function watchLedger(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  useProPier.subscribe((st, was) => {
    const outcome = st.outcome;
    if (!outcome || outcome === was.outcome || (outcome.kind !== 'done' && outcome.kind !== 'partial')) return;
    const owner = useWallet.getState().connection?.address ?? null;
    const landed = landedOf(st.sent?.review.summary);
    if (!owner || !landed) return;
    const whole = outcome.kind === 'done';
    if (landed.action === 'open') {
      const pool = st.pier?.address ?? null;
      const ledger = whole && pool ? ledgerOfOpen(landed, pool, Date.now()) : null;
      if (ledger) writeOne(owner, ledger.nftMint, ledger);
      return;
    }
    const nftMint = st.target && st.target.kind !== 'open' ? st.target.nftMint : null;
    if (!nftMint) return;
    const known = readAll(owner)[nftMint];
    if (!known) return;
    writeOne(owner, nftMint, ledgerAfter(known, landed, whole));
  });
}
