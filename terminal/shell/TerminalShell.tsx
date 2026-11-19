'use client';

import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { hydrateLang } from '@/city/lib/i18n/lang';
import type { CitySnapshot } from '@/city/lib/market/types';
import { startCityAccount } from '@/city/lib/quarter/account-live';
import { closePanel, useWhere } from './frame';
import { startFunnel } from './funnel';
import { Header } from './Header';
import { startMarket } from './market';
import { PhoneBar } from './PhoneBar';
import { Rail } from './Rail';
import { forgetMenu, hydrateMenu, MENU_BOOT_SCRIPT } from './menu-fold';
import { forgetRail, hydrateRail, RAIL_BOOT_SCRIPT } from './rail-fold';
import { usePlaceOnArrival } from './place';
import { SectionsSheet } from './SectionsSheet';
import { MarketSeed } from './useMarket';
import s from './shell.module.css';

/**
 * The terminal's frame, around every screen: the rail, the header with the agent's line, the events and the wallet,
 * and on a phone the five tabs. It stays mounted while the screens change under it, so a move between shelves keeps
 * the wallet, the language and what the agent was told.
 *
 * It starts what every screen stands on, the city's own logic as it is: the person's language (`city/lib/i18n`), the
 * wallet and the sign-in (`city/lib/quarter/account-live.ts`), and the market read (`./market.ts`): a screen reads it with
 * `useMarket()`, which has the bundled snapshot from the server's page on.
 */
export function TerminalShell({ initial, children }: { initial: CitySnapshot; children: ReactNode }) {
  const { pathname } = useWhere();
  // The person's language before the first paint after hydration: the words repaint in it in the same frame.
  useLayoutEffect(() => void hydrateLang(), []);
  // Whether the person keeps the rail folded, from the browser's memory, before the first paint after hydration.
  useLayoutEffect(() => {
    hydrateRail();
    return forgetRail;
  }, []);
  // And which of the menu's groups the person keeps folded.
  useLayoutEffect(() => {
    hydrateMenu();
    return forgetMenu;
  }, []);
  // A place on a screen the menu leads to (`#history`): brought into view once the screen has drawn it.
  usePlaceOnArrival();
  useEffect(() => startCityAccount(), []);
  useEffect(() => startMarket(initial), [initial]);
  // The first action's funnel: the same moments the city counted, now from the terminal.
  useEffect(() => startFunnel(), []);
  // Another screen: the frame's panels close.
  useEffect(() => closePanel(), [pathname]);
  return (
    <MarketSeed.Provider value={initial}>
      {/* The folded rail on the root before the first paint: it does not jump for a person who keeps it folded. */}
      <script dangerouslySetInnerHTML={{ __html: RAIL_BOOT_SCRIPT + MENU_BOOT_SCRIPT }} />
      <div className={s.app}>
        <Rail />
        <div className={s.main}>
          <div className={s.sky} aria-hidden="true" />
          <Header />
          <main className={s.body}>{children}</main>
        </div>
        <PhoneBar />
        <SectionsSheet />
      </div>
    </MarketSeed.Provider>
  );
}
