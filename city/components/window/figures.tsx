'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { useCity } from '@/city/lib/city/store';
import { symbolKey } from '@/lib/phoenix/market-data';
import { price } from '@/city/lib/exchange/format';
import { useExchange } from '@/city/lib/exchange/store';
import { ticker } from '@/city/lib/trade/format';
import type { Params } from '@/city/lib/window/detach';
import { FRESH_MS } from './fresh';
import s from './window.module.css';

/**
 * The live figure on a folded window's chip in the tray (CITY-84), for what the window showed (`params`): the tower's
 * price on the chart's and the trade card's chip — the city's own read, every minute — the market's mark on the
 * Exchange's, the wallet's worth on Money's, each from the store that already holds it; nothing is fetched for a chip.
 * Green or red by the day's move, no words. A window may bring its own (`WindowSpec.figure`); one with neither shows
 * its title.
 */

function Figure({ symbol, value, up }: { symbol: string | null; value: string | null; up: boolean | null }) {
  if (!symbol && !value) return null;
  return (
    <>
      {symbol && <span className={s.chipSymbol}>{ticker(symbol)}</span>}
      {value && <span className={`${s.chipValue} ${up === null ? '' : up ? s.up : s.down}`}>{value}</span>}
    </>
  );
}

/** The window's title, when its figure is not read yet. */
const Title = ({ title }: { title: string }) => <span className={s.chipTitle}>{title}</span>;

function TowerFigure({ mint, title }: { mint: string | null; title: string }) {
  const tower = useCity((st) => (mint ? (st.layout.towers.find((t) => t.tower.id === mint)?.tower ?? null) : null));
  if (!tower) return <Title title={title} />;
  const read = !tower.unread?.includes('price');
  return <Figure symbol={tower.symbol} value={read ? price(tower.price) : null} up={tower.unread?.includes('change24h') ? null : tower.change24h >= 0} />;
}

function ExchangeFigure({ symbol, title }: { symbol: string | null; title: string }) {
  const market = useExchange((st) => (symbol ? (st.markets.value?.markets.find((m) => symbolKey(m.symbol) === symbolKey(symbol)) ?? null) : null));
  const at = useExchange((st) => st.markets.at);
  // The Exchange reads its markets only while it is open: an old read is no live price.
  if (!market || at === null || Date.now() - at > FRESH_MS) return <Title title={title} />;
  const up = market.markPrice !== null && market.prevDayMarkPrice !== null ? market.markPrice >= market.prevDayMarkPrice : null;
  return <Figure symbol={market.symbol.replace(/-PERP$/i, '')} value={market.markPrice !== null ? price(market.markPrice) : null} up={up} />;
}

// Money's store comes with its window: the chip reads it only once the window has been open.
const MoneyFigure = dynamic(() => import('./MoneyFigure'), { ssr: false });

const tower = (title: string, params: Params) => <TowerFigure mint={params.tower ?? null} title={title} />;

/** Each window's chip contents, for what it showed, given its title for when the figure is not read yet. */
export const FIGURES: Readonly<Record<string, (title: string, params: Params) => ReactNode>> = {
  chart: tower,
  swap: tower,
  spot: tower,
  exchange: (title, params) => <ExchangeFigure symbol={params.symbol ?? null} title={title} />,
  money: (title) => <MoneyFigure title={title} />,
};

export { Title as ChipTitle };
