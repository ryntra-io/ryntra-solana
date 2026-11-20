/**
 * The stocks engine's shelf as DLMM Pro's piers read it: the warm universe of `lib/stocks/universe.server.ts`
 * (the venue's verified stocks, each confirmed by its issuer where the issuer publishes a list), cut by the rule of
 * `./stocks.ts`. A universe that did not read names no stock — a stock pier then takes no new money, and what a person
 * holds in one is still read and taken out (`./piers.server.ts`).
 *
 * The routes hand it to the piers and the Review as `stocks`; a test or a rehearsal hands its own.
 */

import "server-only";

import { readStockUniverse } from "../stocks/universe.server.ts";
import { stockSeatsOf, type StockSeats } from "./stocks.ts";

export const readStockSeats: StockSeats = async (mints) => {
  if (mints.length === 0) return new Map();
  const read = await readStockUniverse().catch(() => null);
  if (!read?.ok) return new Map();
  return stockSeatsOf(read.universe.rows, mints);
};
