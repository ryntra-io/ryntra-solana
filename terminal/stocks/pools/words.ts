import { words } from '../../../city/lib/i18n/dict.ts';

/**
 * The words of a stock's pools on its page: the shelf's name, each row's venue, figures and one action, the
 * line of the exchange's hours and the issuer's rights, and what stands behind «i». A person's words: no programs, no
 * steps of bins, no promise of a return.
 */
export const STOCK_POOLS = words(
  {
    title: (symbol: string) => `${symbol} pools`,
    dlmm: 'DLMM',
    pro: 'DLMM Pro',
    pair: (stock: string, other: string) => `${stock} · ${other}`,
    liquidity: 'Liquidity',
    fee: (pct: string) => `Fee ${pct}`,
    day: (usd: string) => `${usd} in 24h`,
    dayFloor: (usd: string) => `≥${usd} in 24h`,
    bonus: (pct: string) => `Bonus +${pct}`,
    deposit: 'Deposit',
    limit: 'Limit with bonus',
    depositIn: (pair: string) => `Deposit in ${pair}`,
    limitIn: (pair: string) => `Limit with bonus in ${pair}`,
    open: (pair: string) => `Open the ${pair} pool`,
    more: (count: string) => `All pools · ${count}`,
    fewer: 'Fewer pools',
    whyHead: 'The pools',
    why: 'Every pool of this stock on Meteora DLMM and DLMM Pro, the deepest first. Liquidity, the fee and a day’s volume are the venue’s own figures — a day gone by, not a promise of what comes.',
    bonusWhy: 'A limit order rests on one price and keeps a share of the pool’s fee on what fills: the bonus. It stands where your limits on this stock rest.',
    depositWhy: 'Deposit opens a position of your own in the pool around the price. You take the fees and leave yourself, whenever you want.',
  },
  {
    title: (symbol: string) => `Пули ${symbol}`,
    dlmm: 'DLMM',
    pro: 'DLMM Pro',
    pair: (stock: string, other: string) => `${stock} · ${other}`,
    liquidity: 'Ліквідність',
    fee: (pct: string) => `Комісія ${pct}`,
    day: (usd: string) => `${usd} за добу`,
    dayFloor: (usd: string) => `≥${usd} за добу`,
    bonus: (pct: string) => `Бонус +${pct}`,
    deposit: 'Вкласти',
    limit: 'Лімітка з бонусом',
    depositIn: (pair: string) => `Вкласти в ${pair}`,
    limitIn: (pair: string) => `Лімітка з бонусом у ${pair}`,
    open: (pair: string) => `Відкрити пул ${pair}`,
    more: (count: string) => `Усі пули · ${count}`,
    fewer: 'Менше пулів',
    whyHead: 'Пули',
    why: 'Усі пули цієї акції на Meteora DLMM і DLMM Pro, найглибші першими. Ліквідність, комісія й обсяг за добу — числа самого пулу: минула доба, не обіцянка того, що буде.',
    bonusWhy: 'Лімітка стоїть на одній ціні й забирає частку комісії пулу з того, що виконалось, — це бонус. Він там, де стоять твої лімітки на цю акцію.',
    depositWhy: '«Вкласти» відкриває твою позицію в пулі біля ціни. Комісії забираєш і виходиш ти сам — коли захочеш.',
  },
);

/** The stand's own page for the eyes (`/terminal/kit/stock-pools`, a stand only). */
export const STOCK_POOLS_STAND = words(
  {
    title: 'Stock pools',
    open: (symbol: string) => `${symbol} · exchange open`,
    closed: (symbol: string) => `${symbol} · exchange closed`,
    coin: (symbol: string) => `${symbol} · in the coin’s column`,
    none: 'A stock with no pools · nothing shows',
  },
  {
    title: 'Пули акцій',
    open: (symbol: string) => `${symbol} · біржа відкрита`,
    closed: (symbol: string) => `${symbol} · біржа закрита`,
    coin: (symbol: string) => `${symbol} · у колонці монети`,
    none: 'Акція без пулів · нічого не видно',
  },
);
