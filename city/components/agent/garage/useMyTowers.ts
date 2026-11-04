'use client';

import { useMemo } from 'react';
import { myTowers, type MyTower } from '@/city/lib/agent/garage/mine';
import { useBeacons } from '@/city/lib/beacon/store';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import { useQuarter } from '@/city/lib/quarter/store';
import { ownedMints, useWallet } from '@/city/lib/trade/wallet';

/**
 * Your towers as the garage agent sees them, and whether the city's read is live: the coins the connected wallet holds
 * (its holdings read only — the agent never connects, asks or signs), the coin your quarter's coin tower shows, and the
 * towers you set a beacon on.
 */
export function useMyTowers(): Readonly<{ mine: MyTower[]; live: boolean }> {
  const snapshot = useCity((st) => st.snapshot);
  const holdings = useWallet((st) => st.holdings);
  const buildings = useQuarter((st) => st.me?.buildings);
  const rules = useBeacons((st) => st.rules);
  return useMemo(() => {
    const quarter = (buildings ?? []).flatMap((b) => (b.link?.kind === 'mint' ? [b.link.mint] : []));
    const beacons = rules.filter((r) => r.on).map((r) => r.mint);
    const mine = myTowers({ towers: snapshot.towers, held: ownedMints(holdings), quarter, beacons });
    return { mine, live: snapshot.source === 'live' && !isStale(snapshot.fetchedAt) };
  }, [snapshot, holdings, buildings, rules]);
}
