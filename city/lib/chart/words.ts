import { words } from '../i18n/dict.ts';

/** The tower chart's own words outside the window (CITY-79): the age and source under the chart, why a coin has none. */
export const CHART_READ = words(
  {
    seconds: (n: number) => `${n}s`,
    minutes: (n: number) => `${n}m`,
    hours: (n: number) => `${n}h`,
    ago: (when: string) => `${when} ago`,
    delayed: 'Delayed',
    NO_POOL: 'No pool prices this coin yet.',
    NO_MAJOR_QUOTE: 'It only trades against coins without a trusted dollar price.',
    THIN: 'No pool holds enough liquidity to chart it.',
    QUIET: 'No pool traded it in the last day.',
    STALE: 'Its newest candle is more than three days old.',
    PRICE_MISMATCH: "The pool's price disagrees with the market price.",
    EMPTY: 'No candles for this coin yet.',
  },
  {
    seconds: (n: number) => `${n} с`,
    minutes: (n: number) => `${n} хв`,
    hours: (n: number) => `${n} год`,
    ago: (when: string) => `${when} тому`,
    delayed: 'Затримка',
    NO_POOL: 'Поки жоден пул не дає ціни цієї монети.',
    NO_MAJOR_QUOTE: 'Вона торгується лише до монет без надійної ціни в доларах.',
    THIN: 'У жодному пулі немає досить ліквідності для графіка.',
    QUIET: 'За останню добу угод із нею не було.',
    STALE: 'Найновішій свічці понад три дні.',
    PRICE_MISMATCH: 'Ціна пулу не збігається з ринковою.',
    EMPTY: 'Свічок цієї монети поки немає.',
  },
);

/** The risk facts under the chart and the coin's age in the city's short words. */
export const CHART_FACTS = words(
  {
    liquidity: 'Liquidity',
    holders: 'Holders',
    age: 'Age',
    thin: 'Thin',
    fresh: 'New',
    underHour: '<1h',
    hours: (n: number) => `${n}h`,
    days: (n: number) => `${n}d`,
    months: (n: number) => `${n}mo`,
    years: (n: number) => `${n}y`,
  },
  {
    liquidity: 'Ліквідність',
    holders: 'Власники',
    age: 'Вік',
    thin: 'Мала',
    fresh: 'Нова',
    underHour: '<1 год',
    hours: (n: number) => `${n} год`,
    days: (n: number) => `${n} дн`,
    months: (n: number) => `${n} міс`,
    years: (n: number) => `${n} р`,
  },
);

/** The chart's own layers: the coin's market marks and the person's entry. */
export const CHART_MARKS = words(
  {
    market: 'Market',
    largeBuy: 'Large buy',
    largeSale: 'Large sale',
    creatorBought: 'Creator bought',
    creatorSold: (share: string) => `Creator sold${share}`,
    leftCurve: 'Left the curve',
    liquidityMove: (move: string) => `Liquidity ${move}`,
    entry: 'Entry',
    yourEntry: 'Your entry',
  },
  {
    market: 'Ринок',
    largeBuy: 'Велика покупка',
    largeSale: 'Великий продаж',
    creatorBought: 'Творець купив',
    creatorSold: (share: string) => `Творець продав${share}`,
    leftCurve: 'Зійшла з кривої',
    liquidityMove: (move: string) => `Ліквідність ${move}`,
    entry: 'Вхід',
    yourEntry: 'Твій вхід',
  },
);
