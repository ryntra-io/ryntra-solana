/**
 * The book of tokenized stocks the look-alike rule reads (`lib/world/text-safety/lookalike.ts`): the static
 * one, of the stocks Ryntra knows by their mint (`known-stocks.ts`) — what a browser and a cold server know — and the
 * same with the server's stock universe added. Pure and client-safe.
 */

import { stockBookOf, stockLookalikeOf, type StockBook, type StockEntry, type StockLookalike } from "../world/text-safety/lookalike.ts";
import { KNOWN_STOCKS } from "./known-stocks.ts";

/** The static book. */
export const KNOWN_STOCK_BOOK: StockBook = stockBookOf(KNOWN_STOCKS);

/** The static book with more known stocks — the server's stock universe — the static rows first. */
export function withStocks(stocks: readonly StockEntry[]): StockBook {
  return stocks.length === 0 ? KNOWN_STOCK_BOOK : stockBookOf([...KNOWN_STOCKS, ...stocks]);
}

/** The stock a coin passes for and is not — its ticker, the company and the real one's mint; null for none. */
export type PassesFor = Readonly<{ ticker: string; company: string; mint: string }>;

/** Whether a coin passes for a tokenized stock it is not, against `book` (the static book by default). */
export function passesForStock(coin: Readonly<{ symbol: string; mint: string; name?: string | null; verified?: boolean | null }>, book: StockBook = KNOWN_STOCK_BOOK): PassesFor | null {
  const hit: StockLookalike | null = stockLookalikeOf(coin, book);
  return hit ? { ticker: hit.ticker, company: hit.company, mint: hit.mint } : null;
}
