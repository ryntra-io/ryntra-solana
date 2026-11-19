'use client';

import { useEffect, useState } from 'react';
import type { DepthAnswer, DepthCoin } from '@/lib/market-depth/model';

const REFRESH_MS = 30_000;

/**
 * One coin's depth from the engine (`/api/v1/market/depth?list=saved&mints=`), read again while the screen is open: its
 * kind, logo, the buys and sells over 5 minutes, an hour, six hours and a day, the holders, the mint's rights. The desk
 * reads it for the facts under the ticket and the market cap's supply.
 */
export function useCoinDepth(mint: string): DepthCoin | null {
  const [coin, setCoin] = useState<DepthCoin | null>(null);
  useEffect(() => {
    let live = true;
    setCoin(null);
    const read = () =>
      fetch(`/api/v1/market/depth?list=saved&mints=${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' } })
        .then((res) => (res.ok ? (res.json() as Promise<DepthAnswer>) : null))
        .then((body) => {
          const found = body?.coins.find((c) => c.id === mint) ?? null;
          if (live && found) setCoin(found);
        })
        .catch(() => undefined);
    void read();
    const timer = setInterval(() => document.visibilityState === 'visible' && void read(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mint]);
  return coin;
}
