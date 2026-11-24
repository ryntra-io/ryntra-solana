import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { answerOf, nextDue, PACE_START, restPace, takeRead, type Pace, type WalletAnswer, type WalletRead } from './watch-view.ts';

/**
 * One reader of wallets for the whole terminal: a wallet's page and the feed of the wallets a person watches ask it, and
 * it asks the engine's public wallet read (`/api/wallet-watch/wallet`) — each wallet once for all who look at it, no
 * sooner than its freshness, a few at once and then one every few seconds, so a list of twenty never runs into the
 * visitor's share of reads. A hidden tab reads nothing. Reads only.
 */

export type ReadStatus = 'reading' | 'ready' | 'failed';
export type ReadEntry = Readonly<{ answer: WalletAnswer | null; status: ReadStatus; at: number | null }>;

type Store = Readonly<{ entries: Readonly<Record<string, ReadEntry>> }>;

export const useWalletReads = create<Store>(() => ({ entries: {} }));

/** Two at once at most. */
const AT_ONCE = 2;
/** A tab in the background looks again this often whether it is in front. */
const HIDDEN_MS = 5_000;

const asked = new Map<string, Map<number, number>>();
const lastAt = new Map<string, number>();
const busy = new Set<string>();
const waiting = new Map<string, ((answer: WalletAnswer) => void)[]>();
let askers = 0;
let pace: Pace = PACE_START;
let timer: ReturnType<typeof setTimeout> | null = null;

function freshness(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [address, by] of asked) if (by.size > 0) out.set(address, Math.min(...by.values()));
  return out;
}

function wake(ms: number): void {
  if (typeof window === 'undefined') return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(pump, Math.max(0, ms));
}

function land(address: string, entry: ReadEntry): void {
  useWalletReads.setState((state) => ({ entries: { ...state.entries, [address]: entry } }));
}

async function read(address: string): Promise<void> {
  busy.add(address);
  const before = useWalletReads.getState().entries[address];
  land(address, { answer: before?.answer ?? null, status: 'reading', at: before?.at ?? null });
  let answer: WalletAnswer;
  try {
    const response = await fetch(`/api/wallet-watch/wallet?${new URLSearchParams({ q: address })}`, { cache: 'no-store', headers: { accept: 'application/json' } });
    answer = answerOf(response.status, await response.json().catch(() => null));
  } catch {
    answer = { kind: 'unread' };
  }
  const now = Date.now();
  busy.delete(address);
  lastAt.set(address, now);
  if (answer.kind === 'busy') pace = restPace(now);
  // A read that fell keeps what the page already shows of the wallet: the figures do not vanish on a hiccup.
  const failed = answer.kind === 'busy' || answer.kind === 'unread';
  const kept = failed && before?.answer && before.answer.kind !== 'busy' && before.answer.kind !== 'unread' ? before.answer : answer;
  land(address, { answer: kept, status: failed ? 'failed' : 'ready', at: failed ? (before?.at ?? null) : now });
  for (const done of waiting.get(address) ?? []) done(answer);
  waiting.delete(address);
  wake(0);
}

function pump(): void {
  timer = null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    // Nothing asked — nothing to look again for.
    if (asked.size > 0) wake(HIDDEN_MS);
    return;
  }
  const fresh = freshness();
  const list = [...fresh.keys()];
  while (busy.size < AT_ONCE) {
    const now = Date.now();
    const next = nextDue(list, lastAt, fresh, busy, now);
    if (!next) break;
    const take = takeRead(pace, now);
    pace = take.pace;
    if (!take.ok) {
      wake(take.wait);
      return;
    }
    void read(next);
  }
  // The next wallet due, when none is reading now; a reading one wakes the pump itself.
  const now = Date.now();
  let soonest = Infinity;
  for (const address of list) {
    if (busy.has(address)) continue;
    soonest = Math.min(soonest, (lastAt.get(address) ?? 0) + (fresh.get(address) ?? 60_000) - now);
  }
  if (Number.isFinite(soonest)) wake(Math.max(250, soonest));
}

/** Read these wallets and keep them no older than `freshMs` while asked; the answer stops the asking. */
export function askReads(addresses: readonly string[], freshMs: number): () => void {
  const id = ++askers;
  for (const address of addresses) {
    const by = asked.get(address) ?? new Map<number, number>();
    by.set(id, freshMs);
    asked.set(address, by);
  }
  wake(0);
  return () => {
    for (const address of addresses) {
      const by = asked.get(address);
      by?.delete(id);
      if (by && by.size === 0) asked.delete(address);
    }
  };
}

/** Read one wallet now (at the reads' pace) and wait for its answer: what an address turns out to be before it is kept. */
export function readOnce(address: string): Promise<WalletAnswer> {
  const entry = useWalletReads.getState().entries[address];
  if (entry?.answer && entry.status === 'ready' && entry.at !== null && Date.now() - entry.at < 60_000) return Promise.resolve(entry.answer);
  return new Promise((resolve) => {
    lastAt.delete(address);
    const stop = askReads([address], 0);
    waiting.set(address, [
      ...(waiting.get(address) ?? []),
      (answer) => {
        stop();
        resolve(answer);
      },
    ]);
  });
}

/** Read one wallet again now, at the reads' pace. */
export function rereadWallet(address: string): void {
  lastAt.delete(address);
  wake(0);
}

/** One wallet, kept fresh while the page shows it. */
export function useWalletRead(address: string | null, freshMs = 30_000): ReadEntry | null {
  useEffect(() => (address ? askReads([address], freshMs) : undefined), [address, freshMs]);
  return useWalletReads((state) => (address ? (state.entries[address] ?? null) : null));
}

/** The wallets of a list, each kept fresh while the list is on screen: what each one read, by its address. */
export function useWalletsRead(addresses: readonly string[], freshMs = 60_000): ReadonlyMap<string, WalletRead | null> {
  const key = addresses.join(',');
  useEffect(() => (key ? askReads(key.split(','), freshMs) : undefined), [key, freshMs]);
  const entries = useWalletReads((state) => state.entries);
  return useMemo(() => {
    const out = new Map<string, WalletRead | null>();
    for (const address of key ? key.split(',') : []) {
      const answer = entries[address]?.answer;
      out.set(address, answer?.kind === 'wallet' ? answer.read : answer?.kind === 'coin' ? answer.read : null);
    }
    return out;
  }, [entries, key]);
}

/** How many of a list's wallets have answered at least once, and whether any of them is reading. */
export function useListReadState(addresses: readonly string[]): Readonly<{ answered: number; reading: boolean; failed: number }> {
  const entries = useWalletReads((state) => state.entries);
  return useMemo(() => {
    let answered = 0;
    let reading = false;
    let failed = 0;
    for (const address of addresses) {
      const entry = entries[address];
      if (entry?.answer) answered += 1;
      if (!entry || entry.status === 'reading') reading = true;
      if (entry?.status === 'failed') failed += 1;
    }
    return { answered, reading, failed };
  }, [entries, addresses]);
}
