import type { Tower, TowerFigure } from '../../city/lib/market/types.ts';
import { SOL } from '../../city/lib/trade/tiles.ts';

/**
 * The Market's list, from the market read every screen stands on (`/api/city`): which coins it names, which stand under
 * each tab, how the search narrows them and how a column sorts them. The coins and their figures are the engine's; the
 * list adds nothing to them.
 *
 * Pure: the screen and the tests read it as it is.
 */

/** The tabs over the list, in the approved design's order. */
export const MARKET_TABS = ['all', 'crypto', 'memes', 'stocks', 'fresh', 'saved'] as const;
export type MarketTab = (typeof MARKET_TABS)[number];

/** A phone's row of tabs, as the approved design draws it: without «Crypto», so the five stand side by side. */
export const PHONE_MARKET_TABS: readonly MarketTab[] = ['all', 'memes', 'stocks', 'fresh', 'saved'];

/** A coin is new for this long after its first pool opened. */
export const FRESH_DAYS = 30;
const DAY_MS = 86_400_000;

/** A column the list sorts by. */
export const SORT_KEYS = ['symbol', 'price', 'change5m', 'change1h', 'change24h', 'volume24h', 'liquidity'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type Sort = Readonly<{ key: SortKey; dir: 'asc' | 'desc' }>;

/** The list opens on the busiest coins. */
export const DEFAULT_SORT: Sort = { key: 'volume24h', dir: 'desc' };

/**
 * The coins the Market names: the ones Jupiter verified, and the launches of the last hours the engine reads. A pool
 * nobody vetted that only trends is not named, as the city never named it.
 */
export function listed(towers: readonly Tower[]): Tower[] {
  return towers.filter((tower) => Boolean(tower.symbol) && (tower.verified || tower.district === 'docks'));
}

/** A launch of the last hours, or a verified coin whose first pool opened within `FRESH_DAYS`. */
export function isFresh(tower: Pick<Tower, 'district' | 'verified' | 'launchedAt'>, now: number): boolean {
  if (tower.district === 'docks') return true;
  if (!tower.verified || !tower.launchedAt) return false;
  const at = Date.parse(tower.launchedAt);
  return Number.isFinite(at) && at <= now && now - at < FRESH_DAYS * DAY_MS;
}

/** Whether a named coin stands under a tab. Every tab but «New» and «Saved» holds verified coins only. */
export function inTab(tower: Tower, tab: MarketTab, saved: ReadonlySet<string>, now: number): boolean {
  switch (tab) {
    case 'all':
      return tower.verified;
    case 'crypto':
      return tower.verified && (tower.district === 'core' || tower.district === 'heights');
    case 'memes':
      return tower.verified && tower.district === 'strip';
    case 'stocks':
      return tower.verified && tower.district === 'avenue';
    case 'fresh':
      return isFresh(tower, now);
    case 'saved':
      return saved.has(tower.id);
  }
}

/** What a person types into the search, as the list reads it: no `$`, no case. */
export function cleanQuery(query: string): string {
  return query.trim().replace(/^\$+/, '').toLowerCase();
}

/** A coin answers the search by its ticker, its name or its own address. */
export function matches(tower: Pick<Tower, 'id' | 'symbol' | 'name'>, query: string): boolean {
  const q = cleanQuery(query);
  if (!q) return true;
  return tower.symbol.toLowerCase().includes(q) || coinName(tower).toLowerCase().includes(q) || tower.id === query.trim();
}

/** The name under a ticker: the engine's, and for SOL the network's own name, as the city writes it. */
export function coinName(tower: Pick<Tower, 'id' | 'name'>): string {
  return tower.id === SOL.mint ? (SOL.name ?? tower.name) : tower.name;
}

/** The sort after a tap on a column's head: the same column turns round; another starts from its natural end. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort.key === key) return { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' };
  return { key, dir: key === 'symbol' ? 'asc' : 'desc' };
}

/** Whether the source measured this figure of the coin: a figure it did not is «—» on screen, never a zero. */
export function measured(tower: Pick<Tower, 'unread'>, figure: TowerFigure): boolean {
  return !tower.unread?.includes(figure);
}

/**
 * The rows in the order a column asks for. A figure the source did not measure stands last whichever way the column
 * runs; equal figures keep the busier coin first, then the ticker.
 */
export function sorted(rows: readonly Tower[], sort: Sort): Tower[] {
  const turn = sort.dir === 'asc' ? 1 : -1;
  const tie = (a: Tower, b: Tower) => b.volume24h - a.volume24h || a.symbol.localeCompare(b.symbol, 'en');
  if (sort.key === 'symbol') return [...rows].sort((a, b) => turn * a.symbol.localeCompare(b.symbol, 'en', { sensitivity: 'base' }) || tie(a, b));
  const key = sort.key;
  return [...rows].sort((a, b) => {
    const known = Number(measured(b, key)) - Number(measured(a, key));
    if (known) return known;
    return turn * (a[key] - b[key]) || tie(a, b);
  });
}

export type MarketView = Readonly<{ tab: MarketTab; query: string; sort: Sort; saved: ReadonlySet<string>; now: number }>;

/** The list on screen: the named coins of the tab that answer the search, in the column's order. */
export function marketRows(towers: readonly Tower[], view: MarketView): Tower[] {
  return sorted(
    listed(towers).filter((tower) => inTab(tower, view.tab, view.saved, view.now) && matches(tower, view.query)),
    view.sort,
  );
}

/** How many coins stand under a tab, the search aside. */
export function tabCount(towers: readonly Tower[], tab: MarketTab, saved: ReadonlySet<string>, now: number): number {
  return listed(towers).filter((tower) => inTab(tower, tab, saved, now)).length;
}

/**
 * The coin the side panel is about: the one picked — the person's, or the list's first as the list stood when it was
 * shown — while the market still names it; a fresh read that reorders the list never moves it. With none picked yet,
 * the list's first.
 */
export function pickedCoin(rows: readonly Tower[], towers: readonly Tower[], picked: string | null): Tower | null {
  if (picked !== null) {
    const kept = rows.find((tower) => tower.id === picked) ?? listed(towers).find((tower) => tower.id === picked);
    if (kept) return kept;
  }
  return rows[0] ?? null;
}
