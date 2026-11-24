/**
 * What the stock keeper reads of the exchange for one pool, from what the stocks engine already knows:
 *
 * - **the session** — the issuer's own trading period (`lib/stocks/session.ts`, through the warm universe of
 *   `lib/stocks/universe.server.ts`), never a «Monday to Friday» rule; a source that says nothing is an unknown session,
 *   and the keeper then does nothing;
 * - **the dividend guard** — the chain's own scheduled step of the token's multiplier (`stepOf`, as the Stock Pier and the
 *   pool page read it);
 * - **the reference** — the exchange's price per share (the issuer's feed, or Pyth), times the token's multiplier, over
 *   SOL's price: the pool's own units. Current only while the exchange is open and the figure is fresh.
 *
 * A devnet stand pool (`RYNTRA_STOCK_KEEPER_STAND_POOLS`) has no stock of its own: it follows the hours a deployment
 * names — `RYNTRA_STOCK_KEEPER_STAND_HOURS`, a listed stock's mint whose session and step it borrows, or `open` /
 * `closed` for a fixed session — and has no reference: a mainnet price says nothing of a test pool.
 *
 * Reads only. Never throws: what did not read is not known.
 */

import type { StockSession, StockStep } from "../../city/lib/earn/stock-pier-hours.ts";
import { referenceInPool } from "./stock-keeper-book.ts";

export type StockFacts = Readonly<{
  session: StockSession | null;
  step: StockStep | null;
  /** The reference in the pool's units, and whether it is current; null — none. */
  reference: Readonly<{ price: number; current: boolean }> | null;
  /** How far the price jumps at an open, bps; null — not known (the keeper then takes the widest range allowed at night). */
  expectedGapBps: number | null;
}>;

export type StockFactsRequest = Readonly<{
  network: "devnet" | "mainnet";
  pool: string;
  /** The stock's mint; null — a stand pool. */
  stockMint: string | null;
  stockIsX: boolean;
  env: Readonly<Record<string, string | undefined>>;
  now: number;
}>;

export type StockFactsRead = (request: StockFactsRequest) => Promise<StockFacts>;

export const STAND_POOLS_ENV = "RYNTRA_STOCK_KEEPER_STAND_POOLS";
export const STAND_HOURS_ENV = "RYNTRA_STOCK_KEEPER_STAND_HOURS";

const NOTHING_KNOWN: StockFacts = Object.freeze({ session: null, step: null, reference: null, expectedGapBps: null });
const SOL = "So11111111111111111111111111111111111111112";
const HOUR = 3_600_000;

/** The devnet stand pools a deployment names; none on mainnet. */
export function standPoolsOf(network: "devnet" | "mainnet", env: Readonly<Record<string, string | undefined>>): readonly string[] {
  if (network !== "devnet") return [];
  return (env[STAND_POOLS_ENV] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry));
}

async function rowOf(mint: string) {
  const { readStockUniverse } = await import("../stocks/universe.server.ts");
  const read = await readStockUniverse().catch(() => null);
  return read?.ok ? (read.universe.rows.find((row) => row.representation.mint === mint) ?? null) : null;
}

async function stepOfMint(mint: string): Promise<StockStep | null> {
  const [{ readOnchainMintCached }, { stepOf }] = await Promise.all([import("../stocks/asset.server.ts"), import("../../city/lib/earn/stock-pier-hours.ts")]);
  const onchain = await readOnchainMintCached(mint).catch(() => null);
  return onchain && !("error" in onchain) ? stepOf(onchain.scaledUi) : null;
}

async function solUsd(): Promise<number | null> {
  const { readSpotMarket } = await import("../spot/markets.server.ts");
  const read = await readSpotMarket(SOL).catch(() => null);
  const price = read && read.ok && read.market ? read.market.price : null;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

/** The engine's own reading, as the keeper's pass and its screen ask it. */
export const readStockFacts: StockFactsRead = async (request) => {
  try {
    if (request.stockMint === null) {
      const named = request.env[STAND_HOURS_ENV]?.trim() ?? "";
      if (named === "open") return { ...NOTHING_KNOWN, session: { open: true, nextChangeAt: new Date(request.now + 6 * HOUR).toISOString() } };
      if (named === "closed") return { ...NOTHING_KNOWN, session: { open: false, nextChangeAt: new Date(request.now + 12 * HOUR).toISOString() } };
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(named)) return NOTHING_KNOWN;
      const [row, step] = await Promise.all([rowOf(named), stepOfMint(named)]);
      return { ...NOTHING_KNOWN, session: row ? { open: row.session.exchangeOpen, nextChangeAt: row.session.nextChangeAt } : null, step };
    }
    const [row, step, sol] = await Promise.all([rowOf(request.stockMint), stepOfMint(request.stockMint), solUsd()]);
    if (!row) return { ...NOTHING_KNOWN, step };
    const session: StockSession = { open: row.session.exchangeOpen, nextChangeAt: row.session.nextChangeAt };
    const price = referenceInPool({ perShareUsd: row.reference.perShare, multiplier: row.multiplier?.current ?? null, solUsd: sol, stockIsX: request.stockIsX });
    return { session, step, reference: price === null ? null : { price, current: row.reference.state === "current" && row.session.exchangeOpen === true }, expectedGapBps: null };
  } catch {
    return NOTHING_KNOWN;
  }
};
