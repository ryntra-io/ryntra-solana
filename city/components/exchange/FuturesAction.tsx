'use client';

import { useEffect } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { EXCHANGE_OPEN } from '@/city/lib/exchange/flag';
import { marketForTower, tradable } from '@/city/lib/exchange/markets';
import { useExchange } from '@/city/lib/exchange/store';
import type { Tower } from '@/city/lib/market/types';
import { ExchangeGlyph } from './glyphs';
import s from './exchange.module.css';

/**
 * «Trade futures» on a tower card: shown only when the Exchange's switch is open and Phoenix lists a market for this
 * very coin. A tap opens the Exchange on that market; the tower card steps aside for it.
 */
export function FuturesAction({ tower }: { tower: Tower }) {
  if (!EXCHANGE_OPEN) return null;
  return <OpenFuturesAction tower={tower} />;
}

/** How long a tower card waits before it asks Phoenix's markets again after a read that failed. */
const RETRY_MS = 15_000;

function OpenFuturesAction({ tower }: { tower: Tower }) {
  const read = useExchange((st) => st.markets);
  const markets = read.value?.markets ?? null;
  // The tower card asks once whether the coin has a perpetual; the list is kept for a minute (MARKETS_FRESH_MS).
  useEffect(() => void useExchange.getState().loadMarkets(), []);
  // A read that failed with nothing on screen is asked again while the card stands, never left without its answer.
  useEffect(() => {
    if (read.status !== 'failed' || read.value) return;
    const timer = setTimeout(() => void useExchange.getState().loadMarkets(true), RETRY_MS);
    return () => clearTimeout(timer);
  }, [read]);
  const market = markets ? marketForTower(tower, markets) : null;
  if (!market) return null;
  const top = market.maxLeverage !== null && market.maxLeverage >= 1 ? `${Math.floor(market.maxLeverage)}×` : 'long or short';
  return (
    <button
      className={s.towerLine}
      onClick={() => {
        if (useCity.getState().sound) playTick();
        useExchange.getState().show(market.symbol);
      }}
    >
      <ExchangeGlyph />
      <span className={`${s.display} ${s.towerLineWord}`}>Trade futures</span>
      <span className={s.towerLineMore}>{tradable(market) ? `${market.symbol}-PERP · ${top}` : `${market.symbol}-PERP · paused`}</span>
    </button>
  );
}
