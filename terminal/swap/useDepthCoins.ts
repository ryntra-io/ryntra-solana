'use client';

import { useEffect, useState } from 'react';
import type { DepthAnswer, DepthCoin } from '@/lib/market-depth/model';

/** How often the pair's figures are read again while the screen is in view. */
const REFRESH_MS = 30_000;
/** The engine reads up to fifty coins by mint at once. */
const MOST = 50;
const NONE: ReadonlyMap<string, DepthCoin> = new Map();

/**
 * Coins by mint as the engine's market reads them (`/api/v1/market/depth?list=saved&mints=`): logo, price and the
 * day's move — for any Solana coin, a tower of the city or not (the pair's two tiles and a logo for every coin
 * of a field's list). `refresh` — read again while the screen is in view. What the engine has not answered stays as it
 * was: a coin missing here is drawn from what the screen already knows, never from a figure of its own.
 */
export function useDepthCoins(mints: readonly string[], refresh = false): ReadonlyMap<string, DepthCoin> {
  const key = [...new Set(mints)].sort().slice(0, MOST).join(',');
  const [coins, setCoins] = useState<ReadonlyMap<string, DepthCoin>>(NONE);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const read = () =>
      fetch(`/api/v1/market/depth?list=saved&mints=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })
        .then((res) => (res.ok ? (res.json() as Promise<DepthAnswer>) : null))
        .then((body) => {
          if (!live || !body) return;
          setCoins((was) => {
            const next = new Map(was);
            for (const coin of body.coins) next.set(coin.id, coin);
            return next;
          });
        })
        .catch(() => undefined);
    void read();
    const timer = refresh ? setInterval(() => document.visibilityState === 'visible' && void read(), REFRESH_MS) : null;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [key, refresh]);
  return coins;
}
