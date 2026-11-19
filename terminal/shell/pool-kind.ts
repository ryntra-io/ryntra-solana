'use client';

import { useSyncExternalStore } from 'react';

/**
 * The pool desk in front and its kind (QA 19.11 ніч, m16): the menu lights «DLMM Pro» only on a DLMM Pro pool and
 * «Pools» on a DLMM or DAMM v2 pool. The desk says its kind once it has read the pool; until then the menu keeps the
 * address's own guess.
 */
export type PoolKind = 'pro' | 'other';

let here: Readonly<{ address: string; kind: PoolKind }> | null = null;
const listeners = new Set<() => void>();

/** The desk's word: this address is a pool of this kind. */
export function setPoolKind(address: string, kind: PoolKind): void {
  if (here?.address === address && here.kind === kind) return;
  here = { address, kind };
  for (const listener of listeners) listener();
}

function subscribe(change: () => void): () => void {
  listeners.add(change);
  return () => {
    listeners.delete(change);
  };
}

/** The kind of the pool at this address, once its desk has said it; null before, and off a pool. */
export function usePoolKind(address: string | null): PoolKind | null {
  return useSyncExternalStore(
    subscribe,
    () => (address && here?.address === address ? here.kind : null),
    () => null,
  );
}
