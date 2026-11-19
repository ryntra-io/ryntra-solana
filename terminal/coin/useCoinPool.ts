'use client';

import { useEffect, useState } from 'react';
import type { EarnPool } from '@/lib/earn-pools/model';
import { poolOfCoin } from './pool-layer';
import { readPools } from './usePoolLayer';

/** How long a failed read of the pools waits before it is asked again. */
const AGAIN_MS = 20_000;

export type CoinPool = Readonly<{ status: 'reading' }> | Readonly<{ status: 'ready'; pool: Readonly<{ pool: EarnPool; side: 'x' | 'y' }> | null }>;

/**
 * The coin's deepest DLMM pool against a dollar (else against SOL), as the chart's liquidity strips take it
 * (`pool-layer.ts`): the desk's book by price reads its bins. `reading` until the engine first answers; then the pool, or
 * null for a coin no listed pool holds (and while a failed read is asked again).
 */
export function useCoinPool(mint: string): CoinPool {
  const [pools, setPools] = useState<readonly EarnPool[] | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () =>
      void readPools().then((got) => {
        if (!live) return;
        if (got.length) return setPools(got);
        // No pools came: the coin's pools stand meanwhile, and the engine is asked again.
        setPools((was) => was ?? []);
        timer = setTimeout(read, AGAIN_MS);
      });
    read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return pools === null ? { status: 'reading' } : { status: 'ready', pool: poolOfCoin(pools, mint) };
}
