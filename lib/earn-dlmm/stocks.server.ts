/**
 * The door of `./stocks.ts` wired for the routes: the pair read from the chain through the endpoints the
 * engine's own pool actions use (`positionsConnections`, the first that answers), the stocks engine's shelf as DLMM Pro's
 * stock piers read it (`lib/earn-pro/stocks.server.ts`), and the engine's own Review, unchanged.
 */

import "server-only";

import { readStockSeats } from "../earn-pro/stocks.server.ts";
import { positionsConnections } from "../liquidity/catalog/chain.server.ts";
import { reviewLiquidityAction } from "../liquidity/studio/actions.server.ts";
import { readPairOn, readStockPool, reviewDlmmStockAdd, stockReadOf, type DlmmPair, type DlmmStockDeps, type Env } from "./stocks.ts";

/** The first endpoint that answers decides; one that fails gives way to the next. */
async function readPair(pool: string): Promise<DlmmPair | null> {
  let last: unknown = new Error("No Solana endpoint is configured.");
  for (const connection of positionsConnections()) {
    try {
      return await readPairOn(connection, pool);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

export function dlmmStockDeps(env: Env = process.env): DlmmStockDeps {
  return { env, pair: readPair, seats: readStockSeats, review: reviewLiquidityAction };
}

/** The screen's read of one pool for one wallet (or none). */
export async function readDlmmStockPool(pool: string, owner: string | null, env: Env = process.env) {
  const read = await readStockPool(pool, dlmmStockDeps(env));
  return read.ok ? ({ ok: true, value: stockReadOf(read.value, owner, env) } as const) : read;
}

export function reviewDlmmStockAction(body: unknown, env: Env = process.env) {
  return reviewDlmmStockAdd(body, dlmmStockDeps(env));
}
