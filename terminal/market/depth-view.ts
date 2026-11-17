import { digits } from '../../city/lib/i18n/dict.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import type { DepthCoin, DepthList, DepthStats, DepthWindow } from '../../lib/market-depth/model.ts';

/**
 * The Market's depth on screen: which coins a filter keeps, how a column sorts them, the age of a coin in a
 * word, the little line of its day. The coins and their figures are the engine's (`/api/v1/market/depth`, Jupiter's
 * Token API v2); nothing here adds a figure — the day's line is drawn through the four moves Jupiter measured.
 *
 * Pure: the screen and the tests read it as it is.
 */

/** The lists over the table, in the approved design's order (macket v2, `A-Market`). «Saved» is the star. */
export const LISTS: readonly DepthList[] = ['trending', 'fresh', 'gainers', 'losers', 'traded', 'stocks'];
/** A phone's row: the four a thumb reaches first. */
export const PHONE_LISTS: readonly DepthList[] = ['trending', 'fresh', 'gainers', 'losers', 'traded', 'stocks'];

export const WINDOWS: readonly DepthWindow[] = ['5m', '1h', '6h', '24h'];
export const DEFAULT_WINDOW: DepthWindow = '1h';

export type AgeBound = 'any' | '1h' | '24h' | '7d' | '30d' | 'old';
export type Way = 'any' | 'up' | 'down';

export type Filters = Readonly<{
  /** Each a floor in dollars or people; null — any. */
  mcap: number | null;
  liquidity: number | null;
  volume: number | null;
  holders: number | null;
  /** Younger than (or, `old`, older than thirty days). */
  age: AgeBound;
  verified: boolean;
  /** Which way the coin moved over the window. */
  change: Way;
}>;

export const DEFAULT_FILTERS: Filters = { mcap: null, liquidity: null, volume: null, holders: null, age: 'any', verified: true, change: 'any' };

/** The floors a filter offers, lowest first; `null` is «any». */
export const STEPS = {
  mcap: [null, 100_000, 1_000_000, 10_000_000, 100_000_000],
  liquidity: [null, 10_000, 100_000, 1_000_000],
  volume: [null, 10_000, 100_000, 1_000_000],
  holders: [null, 100, 1_000, 10_000],
} as const satisfies Record<string, readonly (number | null)[]>;
export const AGES: readonly AgeBound[] = ['any', '1h', '24h', '7d', '30d', 'old'];
export const WAYS: readonly Way[] = ['any', 'up', 'down'];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const AGE_MS: Readonly<Record<Exclude<AgeBound, 'any' | 'old'>, number>> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

/** How many filters stand away from the default — the number on «Filters». */
export function filtersOn(filters: Filters): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
}

const floorOk = (value: number | null, floor: number | null) => floor === null || (value !== null && value >= floor);

/** A coin's age in milliseconds, or null when Jupiter did not say when it was born. */
export function ageMs(coin: Pick<DepthCoin, 'bornAt'>, now: number): number | null {
  if (!coin.bornAt) return null;
  const at = Date.parse(coin.bornAt);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

export const statsOf = (coin: DepthCoin, window: DepthWindow): DepthStats | null => coin.stats[window];
export const changeOf = (coin: DepthCoin, window: DepthWindow): number | null => coin.stats[window]?.change ?? null;
export const volumeOf = (coin: DepthCoin, window: DepthWindow): number | null => coin.stats[window]?.volume ?? null;

/** Whether a coin passes every filter. A figure Jupiter did not measure never passes a floor. */
export function passes(coin: DepthCoin, filters: Filters, window: DepthWindow, now: number): boolean {
  if (filters.verified && !coin.verified) return false;
  if (!floorOk(coin.mcap, filters.mcap) || !floorOk(coin.liquidity, filters.liquidity) || !floorOk(coin.holders, filters.holders)) return false;
  if (!floorOk(volumeOf(coin, window), filters.volume)) return false;
  if (filters.change !== 'any') {
    const change = changeOf(coin, window);
    if (change === null || (filters.change === 'up' ? change <= 0 : change >= 0)) return false;
  }
  if (filters.age !== 'any') {
    const age = ageMs(coin, now);
    if (age === null) return false;
    if (filters.age === 'old' ? age < 30 * DAY : age > AGE_MS[filters.age]) return false;
  }
  return true;
}

/** A column the table sorts by; `rank` is the list's own order (Jupiter's). */
export const SORT_KEYS = ['rank', 'symbol', 'price', 'change5m', 'change1h', 'change6h', 'change24h', 'volume', 'mcap', 'liquidity', 'holders', 'age', 'trades', 'traders'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = Readonly<{ key: SortKey; dir: 'asc' | 'desc' }>;
export const DEFAULT_SORT: Sort = { key: 'rank', dir: 'desc' };

/** The sort after a tap on a column's head: the same column turns round, then back to the list's own order. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort.key !== key) return { key, dir: key === 'symbol' || key === 'age' ? 'asc' : 'desc' };
  const first = key === 'symbol' || key === 'age' ? 'asc' : 'desc';
  return sort.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : DEFAULT_SORT;
}

/** The figure a column sorts by, or null when it was not measured. */
export function sortValue(coin: DepthCoin, key: SortKey, window: DepthWindow, now: number): number | null {
  switch (key) {
    case 'rank':
    case 'symbol':
      return null;
    case 'price':
      return coin.price;
    case 'change5m':
      return changeOf(coin, '5m');
    case 'change1h':
      return changeOf(coin, '1h');
    case 'change6h':
      return changeOf(coin, '6h');
    case 'change24h':
      return changeOf(coin, '24h');
    case 'volume':
      return volumeOf(coin, window);
    case 'mcap':
      return coin.mcap;
    case 'liquidity':
      return coin.liquidity;
    case 'holders':
      return coin.holders;
    case 'age':
      return ageMs(coin, now);
    case 'trades': {
      const s = statsOf(coin, window);
      return s && s.buys !== null && s.sells !== null ? s.buys + s.sells : null;
    }
    case 'traders':
      return statsOf(coin, window)?.traders ?? null;
  }
}

/** The rows in a column's order; an unmeasured figure stands last whichever way the column runs. */
export function sortCoins(coins: readonly DepthCoin[], sort: Sort, window: DepthWindow, now: number): DepthCoin[] {
  if (sort.key === 'rank') return [...coins];
  const turn = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'symbol') return [...coins].sort((a, b) => turn * a.symbol.localeCompare(b.symbol, 'en', { sensitivity: 'base' }));
  return [...coins].sort((a, b) => {
    const x = sortValue(a, sort.key, window, now);
    const y = sortValue(b, sort.key, window, now);
    if (x === null || y === null) return Number(x === null) - Number(y === null);
    return turn * (x - y);
  });
}

/** A coin answers the search by its ticker, its name or its address. */
export function matches(coin: Pick<DepthCoin, 'id' | 'symbol' | 'name'>, query: string): boolean {
  const q = query.trim().replace(/^\$+/, '').toLowerCase();
  if (!q) return true;
  return coin.symbol.toLowerCase().includes(q) || coin.name.toLowerCase().includes(q) || coin.id === query.trim();
}

export type DepthView = Readonly<{ filters: Filters; window: DepthWindow; sort: Sort; query: string; now: number }>;

/** The table on screen. */
export function depthRows(coins: readonly DepthCoin[], view: DepthView): DepthCoin[] {
  return sortCoins(
    coins.filter((coin) => passes(coin, view.filters, view.window, view.now) && matches(coin, view.query)),
    view.sort,
    view.window,
    view.now,
  );
}

/**
 * The day's line of a coin: its price a day, six hours, an hour and five minutes ago, and now — each from the move
 * Jupiter measured over that window. Fewer than three known points draw no line.
 */
export function dayLine(coin: DepthCoin): DayPoint[] | null {
  if (coin.price === null) return null;
  const at = (window: DepthWindow, hoursAgo: number): DayPoint | null => {
    const change = changeOf(coin, window);
    const price = change === null || change <= -100 ? null : coin.price! / (1 + change / 100);
    return price === null || !Number.isFinite(price) ? null : { x: 1 - hoursAgo / 24, price };
  };
  const points = [at('24h', 24), at('6h', 6), at('1h', 1), at('5m', 5 / 60), { x: 1, price: coin.price }].filter((p): p is DayPoint => p !== null);
  return points.length >= 3 ? points : null;
}

/** A point of the day's line: where it stands on the day (0 — a day ago, 1 — now) and the price then. */
export type DayPoint = Readonly<{ x: number; price: number }>;

/** The SVG path of points placed by time (`x` 0…1) in a box. */
export function timePath(points: readonly DayPoint[], width: number, height: number, pad = 2): string {
  if (points.length < 2) return '';
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const span = Math.max(...prices) - lo || 1;
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${(pad + p.x * (width - pad * 2)).toFixed(1)} ${(height - pad - ((p.price - lo) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
}

/** The age in one short word and its unit: minutes, hours, days, months, years. */
export function ageParts(ms: number): Readonly<{ n: number; unit: 'min' | 'h' | 'd' | 'mo' | 'y' }> {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { n: Math.max(1, minutes), unit: 'min' };
  const hours = Math.floor(ms / HOUR);
  if (hours < 24) return { n: hours, unit: 'h' };
  const days = Math.floor(ms / DAY);
  if (days < 60) return { n: days, unit: 'd' };
  const months = Math.floor(days / 30.44);
  if (months < 24) return { n: months, unit: 'mo' };
  return { n: Math.floor(days / 365.25), unit: 'y' };
}

/** The quick-buy sums a person picks from, in SOL. */
export const QUICK_SOL = ['0.05', '0.1', '0.25', '0.5', '1'] as const;
export type QuickSol = (typeof QUICK_SOL)[number];
export const DEFAULT_QUICK: QuickSol = '0.1';
export const isQuick = (value: unknown): value is QuickSol => typeof value === 'string' && (QUICK_SOL as readonly string[]).includes(value);

/** The buys' share of a window's trades, 0–1, or null. */
export function buyShare(stats: DepthStats | null): number | null {
  if (!stats || stats.buys === null || stats.sells === null) return null;
  const all = stats.buys + stats.sells;
  return all > 0 ? stats.buys / all : null;
}

/** The inner padding of a table row and the gap between columns, px: what `fitColumns` counts besides the columns. */
export const TABLE_PAD = 32;
export const TABLE_GAP = 10;

/** The columns that fit a table this wide, in their own order: the lowest ranks first, the rest dropped. */
export function fitColumns<T extends Readonly<{ min: number; rank: number }>>(columns: readonly T[], width: number): T[] {
  const kept = new Set<T>();
  let used = TABLE_PAD - TABLE_GAP;
  for (const column of [...columns].sort((a, b) => a.rank - b.rank)) {
    if (kept.size && used + TABLE_GAP + column.min > width) continue;
    kept.add(column);
    used += TABLE_GAP + column.min;
  }
  return columns.filter((column) => kept.has(column));
}

/** A count, short: 16K, 1.2M — «16 тис.», «1,2 млн» in Ukrainian. */
export function countText(n: number | null, lang: Lang): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const units: [number, string][] = [
    [1e9, lang === 'uk' ? ' млрд' : 'B'],
    [1e6, lang === 'uk' ? ' млн' : 'M'],
    [1e3, lang === 'uk' ? ' тис.' : 'K'],
  ];
  // Rounded first, then the unit: 999,950 reads «1M», not «1000K».
  const round = (v: number) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
  for (const [size, unit] of units) {
    if (size === 1e3 && n < 1e4) break;
    const value = round(n / size);
    if (value >= 1) return digits(`${String(value)}${unit}`, lang);
  }
  return digits(String(Math.round(n)), lang);
}

