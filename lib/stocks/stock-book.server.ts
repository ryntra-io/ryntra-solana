import type { StockBook } from "../world/text-safety/lookalike.ts";
import { withStocks } from "./stock-book.ts";
import { knownStocksOfRows } from "./shelf.ts";
import { peekStockUniverse } from "./universe.server.ts";

/**
 * The stocks a coin may pass for, on the server now: the static book (`known-stocks.ts`) with every
 * representation of the stock universe this instance holds in memory. Never a read: a cold instance answers with the
 * static book and the next request, once the universe is warm, with the whole list. Built once per universe copy.
 */
let built: Readonly<{ at: string | null; book: StockBook }> | null = null;

export function stockBookNow(nowMs: number = Date.now()): StockBook {
  const universe = peekStockUniverse(nowMs);
  const at = universe?.fetchedAt ?? null;
  if (built && built.at === at) return built.book;
  built = { at, book: withStocks(universe ? knownStocksOfRows(universe.rows) : []) };
  return built.book;
}
