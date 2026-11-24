'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useStopsWatch } from '@/terminal/coin/useStopsWatch';
import { useMarket } from '@/terminal/shell/useMarket';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { Page } from '@/terminal/ui';
import { DepthMarket } from './DepthMarket';
import { HomeHero } from './HomeHero';
import { Pulse } from './Pulse';
import { QuickPop } from './QuickBuy';
import { Tiles } from './Tiles';
import d from './depth.module.css';
import m from './market.module.css';

/**
 * The home page — the Market as the navigator (decision 109, macket `docs/terminal/design/2026-11-17-market/`):
 * what Ryntra is and where to go, top to bottom — the agent's panel («Say what to do. Your agent does the rest.»), five
 * doors to the sections, the Pulse of what is being born on Solana right now, and the table of every coin with its
 * filters. There is no side form: a coin opens its own page, and a ⚡ beside it buys in one tap, right there.
 */
export function MarketScreen() {
  const names = useWords(SHELF_WORDS);
  const towers = useMarket().towers;
  useStopsWatch(null);
  return (
    <Page kind="desk" className={d.page}>
      {/* The page's one heading, for the reader and the index; the eye reads the promise first. */}
      <h1 className={m.hidden}>{names.market}</h1>
      <HomeHero towers={towers} />
      <Tiles towers={towers} />
      <Pulse towers={towers} />
      <DepthMarket />
      <QuickPop />
    </Page>
  );
}
