'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useLang } from '@/city/lib/i18n/lang';
import { CoinChart } from '@/terminal/coin/CoinChart';
import { standIn } from '@/terminal/coin/coin-view';
import { useDayMove } from '@/terminal/market/day-move';
import { coinName } from '@/terminal/market/market-view';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { CoinLogo, Icon, Panel, changeText, changeTone, priceText } from '@/terminal/ui';
import { useTowers, type PickedCoin } from './parts';
import g from './grid.module.css';

const NO_TRADES: readonly never[] = [];

/**
 * A bot's chart:
 * the coin the bot works on in the terminal's own chart — the Spot's core chart (`terminal/coin/CoinChart.tsx`), its
 * intervals, indicators and drawing tools — with the bot's own lines over the candles where it has them (the ladder's
 * prices, through the chart's layer). Its head: the coin, its price and its day; a tap opens the coin's own screen.
 * `price` — the price the bot's form works from where it is not the market's (the ladder's pool), «reading» — «—» until
 * it comes. As a bot stands at Binance, OKX and Pionex: the chart first, the form beside it.
 */
export function BotChart({ coin, price, label }: { coin: PickedCoin; price?: number | 'reading'; label: string }) {
  const lang = useLang();
  const phone = useNarrow();
  const towers = useTowers();
  /* A coin the market read does not hold (any coin of Solana, picked by search) stands in the market's own shape, so the
     chart takes it as the Spot and the Grid do. */
  const inMarket = towers.get(coin.mint);
  const outside = useMemo(
    () => standIn({ mint: coin.mint, symbol: coin.symbol, name: coin.name ?? coin.symbol, icon: coin.icon, verified: coin.verified ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inMarket === undefined, coin.mint, coin.symbol, coin.name, coin.icon, coin.verified],
  );
  const tower = inMarket ?? outside;
  const moved = useDayMove(coin.mint);
  const market = tower && !tower.unread?.includes('price') && tower.price > 0 ? tower.price : null;
  const now = price === 'reading' ? null : typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : market;
  const name = tower?.name ? coinName(tower) : null;
  const words = (
    <>
      <CoinLogo src={coin.icon} symbol={coin.symbol} size="s" />
      <span className={g.headSymbol}>{coin.symbol}</span>
      {name && name.trim().toUpperCase() !== coin.symbol.trim().toUpperCase() ? <span className={g.headName}>{name}</span> : null}
      <span className={g.headPrice}>{now !== null ? priceText(now, lang) : '—'}</span>
      {moved !== null ? <span className={changeTone(moved) === 'up' ? g.headUp : changeTone(moved) === 'down' ? g.headDown : g.headFlat}>{changeText(moved, lang)}</span> : null}
    </>
  );
  return (
    <Panel pad="none" label={label} className={g.chartPanel}>
      {shelfOn('market') ? (
        <Link href={coinHref(coin.mint, 'live')} className={g.chartHead} data-bot-chart-head="">
          {words}
          <Icon name="arrow" size="s" />
        </Link>
      ) : (
        <div className={g.chartHead} data-still="" data-bot-chart-head="">
          {words}
        </div>
      )}
      <div className={g.chart} data-bot-chart="">
        <CoinChart coin={tower} sym={coin.symbol} cap={null} trades={NO_TRADES} phone={phone} />
      </div>
    </Panel>
  );
}
