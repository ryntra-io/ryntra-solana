'use client';

import { useEffect, type ReactNode } from 'react';
import { startCityAccount } from '@/city/lib/quarter/account-live';
import { siteStore } from '@/city/lib/quarter/site';
import { useAway } from '@/city/lib/quarter/away-store';
import { useQuarter } from '@/city/lib/quarter/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { AwayReel, useAwayWatch } from './AwayReel';
import { BuildHud } from './BuildHud';
import { FreeEntry, FreeHud } from './kit/free/FreeHud';
import { useFree } from '@/city/lib/quarter/kit/free/store';
import { watchSound } from './sound';

/**
 * Follows whose place this is (the wallet signed in to Ryntra, `account.ts`) and reads it, and while they build, the quarter's own screen stands in
 * for the city's HUD (`children`), as a run does: one screen, one goal. So does «While you were away» when they come back. It hands the city's wallet to the quarter's
 * engine reads.
 */
export function QuarterLayer({ children, onSound }: { children: ReactNode; onSound: (on: boolean) => void }) {
  const mode = useQuarter((st) => st.mode);
  // Whose quarter this is follows the wallet and its Ryntra sign-in: a visitor sees the city, a signed-in wallet its place.
  useEffect(() => {
    const stop = startCityAccount();
    const unwatch = watchSound();
    return () => {
      stop();
      unwatch();
    };
  }, []);
  // The buildings on the engine read by the wallet the city is connected to, the same one the trade card uses.
  useEffect(() => {
    const hand = (c: { wallet: string; address: string } | null) => siteStore.getState().setConnection(c ? { wallet: c.wallet, address: c.address } : null);
    hand(useWallet.getState().connection);
    return useWallet.subscribe((st) => hand(st.connection));
  }, []);
  // Back in the city after a while: «While you were away» owns the screen for its twenty seconds, then the HUD returns.
  useAwayWatch();
  const away = useAway((st) => st.status === 'playing');
  const free = useFree((st) => st.on);
  if (mode === 'city') return away ? <AwayReel /> : <>{children}</>;
  // Free building owns the screen while it is on; otherwise the quarter's sheet, with the way into it.
  if (free) return <FreeHud />;
  return (
    <>
      <BuildHud onSound={onSound} />
      <FreeEntry />
    </>
  );
}
