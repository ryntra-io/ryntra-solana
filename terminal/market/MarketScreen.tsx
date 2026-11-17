'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useStopsWatch } from '@/terminal/coin/useStopsWatch';
import { useMarket } from '@/terminal/shell/useMarket';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { DepthMarket } from './DepthMarket';
import { HomeHero } from './HomeHero';
import m from './market.module.css';

/**
 * The home page and the Market (macket v2 «A + Pro from B»): first what Ryntra is and the agent's field —
 * «Say what to do. Your agent does the rest.» — with three doors of live figures (`./HomeHero.tsx`); under it the
 * market with its depth: the lists, the filters, the windows, every coin's age, holders and rights, a quick buy on the
 * side ticket, «Pro» for the density (`./DepthMarket.tsx`). The market read every screen stands on (`/api/city`) gives
 * the doors and the Pro strip their figures; the depth is the engine's own read of Jupiter (`/api/v1/market/depth`).
 */
export function MarketScreen() {
  const names = useWords(SHELF_WORDS);
  const towers = useMarket().towers;
  useStopsWatch(null);
  return (
    <>
      {/* The page's one heading, for the reader and the index; the eye reads the promise first. */}
      <h1 className={m.hidden}>{names.market}</h1>
      <HomeHero towers={towers} />
      <DepthMarket towers={towers} />
    </>
  );
}
