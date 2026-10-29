import { symbolKey, type BookLevelRow, type FuturesBook } from '../../../lib/phoenix/market-data.ts';

/**
 * The Book tab: Phoenix's order book of the open market as the engine reads it (`/api/solana/futures/book`, uncut by
 * the execution band), the nearest levels of each side, each with the depth that stands up to it. The prices and sizes
 * are Phoenix's; the city only adds them up level by level to draw the depth and says how far the two best prices
 * stand apart. Pure.
 */

/** How many levels of each side the tab shows: enough to read the book, few enough to stand on a phone. */
export const BOOK_ROWS = 10;

/** The book is read again this often while its tab is open: the route keeps a read for one second at the edge. */
export const BOOK_MS = 2_000;

/** How old the last good read may be before the tab says the book is delayed: a few of its refreshes. */
export const BOOK_STALE_MS = 10_000;

export type DepthRow = Readonly<{
  price: number;
  /** In the base asset, as Phoenix sends it. */
  size: number;
  /** The size from the best price up to and with this level. */
  total: number;
  /** That depth against the deeper side's, 0 to 1: the bar behind the row. */
  depth: number;
}>;

export type DepthView = Readonly<{
  /** Asks from the best (lowest) up; bids from the best (highest) down. */
  asks: readonly DepthRow[];
  bids: readonly DepthRow[];
  /** The best ask less the best bid, dollars, and that against their middle, per cent; null without both sides. */
  spreadUsd: number | null;
  spreadPercent: number | null;
}>;

const EMPTY: DepthView = { asks: [], bids: [], spreadUsd: null, spreadPercent: null };

function sideRows(levels: readonly BookLevelRow[], rows: number): Array<Omit<DepthRow, 'depth'>> {
  let total = 0;
  return levels.slice(0, rows).map((level) => {
    total += level.size;
    return { price: level.price, size: level.size, total };
  });
}

/**
 * The tab's rows for the open market; nothing for another market's book, so a market just picked never shows the last
 * one's levels. A book whose sides cross — a read caught between two prints — still lists what Phoenix sent, and its
 * spread is not said.
 */
export function depthView(book: FuturesBook | null, symbol: string | null, rows = BOOK_ROWS): DepthView {
  if (!book || !symbol || symbolKey(book.symbol) !== symbolKey(symbol)) return EMPTY;
  const asks = sideRows(book.asks, rows);
  const bids = sideRows(book.bids, rows);
  const deepest = Math.max(asks.at(-1)?.total ?? 0, bids.at(-1)?.total ?? 0);
  const withDepth = (row: Omit<DepthRow, 'depth'>): DepthRow => ({ ...row, depth: deepest > 0 ? row.total / deepest : 0 });
  const ask = asks[0]?.price ?? null;
  const bid = bids[0]?.price ?? null;
  const spread = ask !== null && bid !== null && ask >= bid ? ask - bid : null;
  const middle = ask !== null && bid !== null ? (ask + bid) / 2 : null;
  return {
    asks: asks.map(withDepth),
    bids: bids.map(withDepth),
    spreadUsd: spread,
    spreadPercent: spread !== null && middle !== null && middle > 0 ? (spread / middle) * 100 : null,
  };
}

/** Whether the book on screen is older than it should be: the last read failed or came long ago. */
export const bookStale = (read: Readonly<{ status: string; at: number | null }>, now: number): boolean => read.status === 'failed' || (read.at !== null && now - read.at > BOOK_STALE_MS);
