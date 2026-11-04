'use client';

import { useEffect, type ReactNode } from 'react';
import { startCityAccount } from '@/city/lib/quarter/account-live';
import { inviteFrom } from '@/city/lib/quarter/crew';
import { crewStore, useCrew } from '@/city/lib/quarter/crew-store';
import { siteStore } from '@/city/lib/quarter/site';
import { useAway } from '@/city/lib/quarter/away-store';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { AwayReel, useAwayWatch } from './AwayReel';
import { BuildHud } from './BuildHud';
import { CrewSheet } from './CrewSheet';
import { FreeEntry, FreeHud } from './kit/free/FreeHud';
import { useFree } from '@/city/lib/quarter/kit/free/store';
import { watchSound } from './sound';
import q from './quarter.module.css';

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
  useCrewWatch();
  // Back in the city after a while: «While you were away» owns the screen for its twenty seconds, then the HUD returns.
  useAwayWatch();
  const away = useAway((st) => st.status === 'playing');
  const free = useFree((st) => st.on);
  // An invite that came by a link shows over the city, with its one action.
  const invite = useCrew((st) => st.view === 'invite');
  if (mode === 'city') {
    if (away) return <AwayReel />;
    return (
      <>
        {children}
        {invite && (
          <div className={q.layer}>
            <CrewSheet overCity />
          </div>
        )}
      </>
    );
  }
  // Free building owns the screen while it is on; otherwise the quarter's sheet, with the way into it.
  if (free) return <FreeHud />;
  return (
    <>
      <BuildHud onSound={onSound} />
      <FreeEntry />
    </>
  );
}

/**
 * The crew follows the quarter (CITY-20): read when a place is mine, forgotten when it is not, the sheet closed when a
 * plot is picked or the city comes back; and an invite in the address (`?crew=CODE`) is read once, then taken out of
 * the address so a reload or a shared screenshot does not carry it.
 */
function useCrewWatch() {
  useEffect(() => {
    const code = inviteFrom(window.location.search);
    if (code && crewStore.getState().status !== 'off') {
      void crewStore.getState().peek(code);
      const url = new URL(window.location.href);
      url.searchParams.delete('crew');
      window.history.replaceState(window.history.state, '', url);
    }
    let owner = quarterStore.getState().status === 'resident' ? quarterStore.getState().owner : null;
    if (owner !== null) void crewStore.getState().read();
    return quarterStore.subscribe((st, before) => {
      const now = st.status === 'resident' ? st.owner : null;
      if (now !== owner) {
        owner = now;
        if (now !== null) void crewStore.getState().read();
        else crewStore.setState({ crew: null, status: crewStore.getState().status === 'off' ? 'off' : 'none' });
      }
      const crew = crewStore.getState();
      if (crew.view && crew.view !== 'invite' && ((st.slot !== null && before.slot === null) || (st.mode === 'city' && before.mode !== 'city'))) crew.close();
    });
  }, []);
}
