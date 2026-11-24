'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { KNOWN_STOCK_BOOK } from '@/lib/stocks/stock-book';
import { CoinChart } from '@/terminal/coin/CoinChart';
import { standIn } from '@/terminal/coin/coin-view';
import { useDayMove } from '@/terminal/market/day-move';
import { coinName } from '@/terminal/market/market-view';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { chipKey, chipOf, timeText } from '@/terminal/stocks/facts-view';
import { useStockPoolFacts } from '@/terminal/stocks/useStockPoolFacts';
import { STOCK_FACTS } from '@/terminal/stocks/words';
import { CoinLogo, Icon, Panel, changeText, changeTone, priceText } from '@/terminal/ui';
import { useTowers, type PickedCoin } from './parts';
import g from './grid.module.css';

const NO_TRADES: readonly never[] = [];

/**
 * A stock's exchange in the chart's head, as the stocks engine reads it: «Exchange open · closes 22:00»,
 * «Exchange closed · opens Mon 15:30», in the person's own clock. Read only for a stock; nothing while no source says.
 */
function ExchangeState({ mint }: { mint: string }) {
  const lang = useLang();
  const w = useWords(STOCK_FACTS);
  const facts = useStockPoolFacts(mint);
  const now = Date.now();
  const chip = chipOf(facts, now);
  if (!chip) return null;
  const key = chipKey(chip);
  const text = chip.at === null ? (w[key as keyof typeof w] as string) : (w[key as keyof typeof w] as (time: string) => string)(timeText(chip.at, now, lang));
  return (
    <span className={g.headSession} data-open={chip.key === 'open' ? '' : undefined} data-bot-exchange={chip.key}>
      {text}
    </span>
  );
}

/**
 * A bot's chart:
 * the coin the bot works on in the terminal's own chart — the Spot's core chart (`terminal/coin/CoinChart.tsx`), its
 * intervals, indicators and drawing tools — with the bot's own lines over the candles where it has them (the ladder's
 * prices, through the chart's layer). Its head: the coin, its price and its day; a tap opens the coin's own screen.
 * `price` — the price the bot's form works from where it is not the market's (the ladder's pool), «reading» — «—» until
 * it comes. As a bot stands at Binance, OKX and Pionex: the chart first, the form beside it. A tokenized stock — `stock`,
 * or a mint of the stocks' book — carries its exchange's state in the head.
 */
export function BotChart({ coin, price, label, stock }: { coin: PickedCoin; price?: number | 'reading'; label: string; stock?: boolean }) {
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
      {now !== null && moved !== null ? <span className={changeTone(moved) === 'up' ? g.headUp : changeTone(moved) === 'down' ? g.headDown : g.headFlat}>{changeText(moved, lang)}</span> : null}
      {stock ?? KNOWN_STOCK_BOOK.mints.has(coin.mint) ? <ExchangeState mint={coin.mint} /> : null}
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
