/**
 * Which coin is a stock, as the agent's engine asks it: the shelf of verified companies, read by the engine
 * itself.
 *
 * A tokenized stock's mint carries its issuer's rights, and the agent's rule refuses each of them on any coin
 * (`./token-2022.ts`). The one way past is the shelf: a mint is a stock when, and only when, its address is on the shelf
 * of listed companies now (`../stocks/shelf.ts` `isShelfStock` — a listed company's token of xStocks or Backpack that
 * the issuer's own catalogue names and a person can buy today; a card that moved to the company's other token leaves
 * the first one a stock). Who asks reads the shelf here; nothing a request, a form or a mint says of itself makes a
 * coin a stock.
 *
 * - The shelf not read is no stock: the coin is judged by the strict rule, and a stock is then refused — never the
 *   other way round. A copy of the shelf older than `SHELF_MAX_AGE_MS` is a shelf not read.
 * - A coin the strict rule takes never touches the shelf: the agent's other coins do not wait on it.
 * - The whole path stands behind two switches, both exactly `open`: the server's own, `RYNTRA_BOTS_STOCKS`, read when
 *   it is asked — so the engine and the signer close without a new build — and the form's,
 *   `NEXT_PUBLIC_RYNTRA_BOTS_STOCKS`, which only decides whether the card offers a stock. The form's alone arms
 *   nothing here: a budget for a stock is then refused before a signature (`./service.server.ts`). With either closed
 *   no coin is a stock and the engine is the one it always was.
 */

import type { PublicKey } from "@solana/web3.js";

import { isShelfStock } from "../stocks/shelf.ts";
import type { StockUniverse } from "../stocks/universe.server.ts";
import { TOKEN_2022_PROGRAM_ID, readCoin, type CoinReading } from "./token-2022.ts";

/** Whether a mint is, by its address, a company's token on the shelf now; throws when the shelf is not read. */
export type StockShelf = (mint: string) => Promise<boolean>;

/** No coin is a stock: devnet, a test's own chain, a switch closed. */
export const NO_STOCKS: StockShelf = async () => false;

/** The server's switch: the engine and the signer take a stock only where a deployment sets it to `open` (exactly). */
export const STOCKS_SERVER_ENV = "RYNTRA_BOTS_STOCKS";
/** The form's switch (`terminal/bots/stock-buys.ts` `BOTS_STOCKS_OPEN`): whether the card offers a stock. */
export const STOCKS_FORM_ENV = "NEXT_PUBLIC_RYNTRA_BOTS_STOCKS";

type Env = Readonly<Record<string, string | undefined>>;

/** Both switches open, read now: the server's own and the form's. */
export const stocksOpen = (env: Env = process.env): boolean => env[STOCKS_SERVER_ENV] === "open" && env[STOCKS_FORM_ENV] === "open";

/** The oldest copy of the shelf the engine takes a stock by: what the stocks engine itself calls stale. */
export const SHELF_MAX_AGE_MS = 15 * 60_000;

/**
 * Whether the shelf, as this copy of the stocks universe holds it, names the mint; throws when the copy is older than
 * `SHELF_MAX_AGE_MS` or says no time of its own — the platform's cache may hand back a universe read long ago, and a
 * token its issuer has since halted or dropped must not pass on yesterday's word.
 */
export function shelfHolds(universe: Pick<StockUniverse, "rows" | "fetchedAt">, mint: string, nowMs: number): boolean {
  const readAt = Date.parse(universe.fetchedAt);
  if (!Number.isFinite(readAt) || nowMs - readAt > SHELF_MAX_AGE_MS) throw new Error("the shelf of companies is not fresh");
  return isShelfStock(universe.rows, mint);
}

/** The shelf as the stocks engine lists it now. */
export const shelfStock: StockShelf = async (mint) => {
  const { readStockUniverse } = await import("../stocks/universe.server.ts");
  const read = await readStockUniverse();
  if (!read.ok) throw new Error("the shelf of companies is not read");
  return shelfHolds(read.universe, mint, Date.now());
};

/** The shelf of this network's engine: mainnet's with both switches open, none anywhere else. */
export const stocksOf = (network: string, env: Env = process.env): StockShelf => (network === "mainnet" && stocksOpen(env) ? shelfStock : NO_STOCKS);

/**
 * The coin as the agent trades it (`readCoin`), a stock of the shelf among them: the strict rule first; a Token-2022 mint
 * it refuses is looked up on the shelf, and one found there is read again as a stock — under its conditions, on the very
 * bytes just read.
 */
export async function readShelfCoin(mint: PublicKey, info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null | undefined, epoch: bigint | undefined, shelf: StockShelf): Promise<CoinReading> {
  const strict = readCoin(mint, info, epoch);
  if (strict.ok || !info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return strict;
  const listed = await shelf(mint.toBase58()).catch(() => false);
  return listed ? readCoin(mint, info, epoch, { stock: true }) : strict;
}
