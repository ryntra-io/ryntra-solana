import "server-only";

import { stepOf } from "@/city/lib/earn/stock-pier-hours";
import { readOnchainMintCached } from "@/lib/stocks/asset.server";
import { notAStock, poolFactsOf, type PoolFacts } from "@/lib/stocks/pool-facts";
import { readStockUniverse } from "@/lib/stocks/universe.server";

/**
 * The facts of one pool's mint on the server, read only: the stock row from the engine's warm universe (its
 * session is the issuer's own), and — for a stock only — the multiplier's scheduled step from the engine's cached mint
 * read. A mint the universe does not hold is no stock. Null when the universe itself could not be read: a page then
 * shows nothing rather than call a stock «not a stock».
 */
export async function readPoolFacts(mint: string, nowMs: number = Date.now()): Promise<PoolFacts | null> {
  const universe = await readStockUniverse().catch(() => null);
  if (!universe?.ok) return null;
  const row = universe.universe.rows.find((candidate) => candidate.representation.mint === mint) ?? null;
  if (!row) return notAStock(mint);
  const onchain = await readOnchainMintCached(mint).catch(() => null);
  const step = onchain && !("error" in onchain) ? stepOf(onchain.scaledUi) : null;
  return poolFactsOf({ mint, row, step, nowMs });
}
