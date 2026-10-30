'use client';

import { useMemo } from 'react';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { allLaunches, useLaunch } from '@/city/lib/launch/district';
import { lensTowers, type LensContext } from '@/city/lib/lens/lens';
import { useLens } from '@/city/lib/lens/store';
import { glowingMints, useTrade } from '@/city/lib/trade/store';
import { ownedMints, useWallet } from '@/city/lib/trade/wallet';

/**
 * What the Lens reads from the rest of the city: the engine's listed companies, the coins of the connected wallet (as
 * «Mine» in the trade card reads them, a buy of a moment ago included) and Ryntra's own launches with their curves.
 */
export function useLensContext(): LensContext {
  const stocks = useLens((st) => st.stocks);
  const holdings = useWallet((st) => (st.connection && st.holdings?.owner === st.connection.address ? st.holdings : null));
  const optimistic = useTrade((st) => st.optimistic);
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  return useMemo(() => {
    const now = Date.now();
    const launches = new Map(allLaunches({ feed, mine }, now).map((launch) => [launch.token, { progress: launch.progress, migrated: launch.migrated }]));
    return { stocks, owned: glowingMints(ownedMints(holdings), optimistic, now), launches, now };
  }, [stocks, holdings, optimistic, feed, mine]);
}

/** The towers of the picked chip in today's layout, and the context they were picked with. */
export function useLensSet(): { towers: readonly PlacedTower[]; set: readonly PlacedTower[]; ctx: LensContext } {
  const towers = useCity((st) => st.layout.towers);
  const lens = useLens((st) => st.lens);
  const ctx = useLensContext();
  const set = useMemo(() => lensTowers(lens, towers, ctx), [lens, towers, ctx]);
  return { towers, set, ctx };
}
