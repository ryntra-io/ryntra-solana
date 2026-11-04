import type { LiquidityReview } from '../../../lib/liquidity/studio/actions.ts';
import { admitStockBuild, withinStockCeiling, type Env } from './stock-pier-gate.ts';
import { dividendGuard } from './stock-pier-hours.ts';
import { QUOTE, STOCK_PIER_SLIPPAGE_BPS, STOCK_PIER_VENUE, depositUsdOf, parseStockBuild, rawPrice, type StockPair, type StockQuote } from './stock-pier.ts';
import type { StockBuildPlan } from './stock-pier-venue.ts';

/**
 * The Stock Pier's door (CITY-98) in front of the engine's Review: whether this wallet may put new money in (the
 * product's switch, canary and stop), whether the stock is one the server verified (and still offers now), whether a
 * corporate step of its multiplier holds new liquidity, the live price the pool is made at, and the ceiling at those
 * prices. Past it, the engine's own Review builds, checks, simulates and seals — with the Stock Pier's venue for the
 * one thing the engine does not make: a new pier. What the engine hands back must be an add on that very pier with
 * those very coins, or the ticket is dropped here and never reaches the wallet.
 *
 * Pure: everything it reads comes in through `deps`.
 */

export type EngineReviewBody = Readonly<{
  action: 'add';
  venue: typeof STOCK_PIER_VENUE;
  request: Readonly<{
    pool: string;
    owner: string;
    amountX: string;
    amountY: string;
    slippageBps: number;
  }>;
}>;

export type DoorFailure = Readonly<{
  ok: false;
  status: number;
  code: string;
  reason: string;
}>;
export type ReviewAnswer = Readonly<{ ok: true; value: LiquidityReview }> | DoorFailure;

export type StockDoorDeps = Readonly<{
  env: Env;
  /** The verified pair for a stock mint as the server offers it now; null — not offered. */
  pairOf: (mint: string) => Promise<StockPair | null>;
  /** Dollars for one SOL or one USDC now; null when not read. */
  quoteUsd: (quote: StockQuote) => Promise<number | null>;
  /** The engine's Review with the Stock Pier's venue for this plan. */
  review: (body: EngineReviewBody, plan: StockBuildPlan, pair: StockPair, quoteUsd: number) => Promise<ReviewAnswer>;
  now: () => number;
}>;

export type StockDoorAnswer =
  | Readonly<{
      ok: true;
      value: LiquidityReview;
      builds: boolean;
      pool: string;
    }>
  | DoorFailure;

const fail = (status: number, code: string, reason: string): DoorFailure => ({
  ok: false,
  status,
  code,
  reason,
});

/** How far a pier's own price may stand from the live market's before the door refuses it, basis points. */
export const STOCK_PIER_PRICE_DRIFT_BPS = 100;

/** Whether a pool's price (a decimal string, Y per X) is within the drift of the market's. */
export function priceAgrees(poolPrice: string, market: number, driftBps: number = STOCK_PIER_PRICE_DRIFT_BPS): boolean {
  const value = Number(poolPrice);
  if (!(value > 0) || !Number.isFinite(value) || !(market > 0) || !Number.isFinite(market)) return false;
  return Math.abs(value / market - 1) * 10_000 <= driftBps;
}

export async function reviewStockBuild(body: unknown, deps: StockDoorDeps): Promise<StockDoorAnswer> {
  const asked = parseStockBuild(body);
  if (!asked) return fail(400, 'BAD_REQUEST', 'The request was not understood.');
  const admitted = admitStockBuild(asked.owner, deps.env);
  if (!admitted.ok) return fail(403, admitted.code, 'The Stock Pier takes no new money from this wallet now.');
  const pair = await deps.pairOf(asked.stock);
  if (!pair) return fail(403, 'STOCK_PIER_PAIR', 'This stock is not one the Stock Pier offers now.');
  if (dividendGuard(pair.step, deps.now()).kind === 'hold') return fail(409, 'STOCK_PIER_DIVIDEND', 'New liquidity waits until the corporate step has passed.');
  const quoteUsd = await deps.quoteUsd(asked.quote);
  const price = rawPrice(pair, quoteUsd);
  if (quoteUsd === null || price === null) return fail(503, 'STOCK_PIER_UNPRICED', 'There is no live price to make the pier at.');
  const amountA = BigInt(asked.amountA);
  const amountB = BigInt(asked.amountB);
  if (!withinStockCeiling(depositUsdOf(pair, asked.quote, quoteUsd, amountA, amountB), admitted.ceilingUsd))
    return fail(403, 'STOCK_PIER_CEILING', 'More than the Stock Pier takes in one go for now.');

  const spot = pair.piers[asked.quote];
  const quoteMint = QUOTE[asked.quote].mint;
  // A standing pier made the other way round takes the quote coin as its X.
  const stockIsX = spot.stockIsA;
  const request = {
    pool: spot.address,
    owner: asked.owner,
    amountX: stockIsX ? asked.amountA : asked.amountB,
    amountY: stockIsX ? asked.amountB : asked.amountA,
    slippageBps: STOCK_PIER_SLIPPAGE_BPS,
  };
  const plan: StockBuildPlan = {
    owner: asked.owner,
    stock: pair.mint,
    quote: quoteMint,
    price,
  };
  const reviewed = await deps.review({ action: 'add', venue: STOCK_PIER_VENUE, request }, plan, pair, quoteUsd);
  if (!reviewed.ok) return reviewed;
  const preview = reviewed.value.preview;
  const [x, y] = stockIsX ? [pair.mint, quoteMint] : [quoteMint, pair.mint];
  const same = preview.action === 'add' && preview.pool === spot.address && preview.deposit.x.asset === x && preview.deposit.y.asset === y;
  if (!same) return fail(403, 'STOCK_PIER_PAIR', 'This build is outside what the Stock Pier takes.');
  // A standing pier was made by someone else: its price must be the market's and the add must earn at it, or a pool
  // made at a crooked price would take the person's deposit at that price.
  const expected = stockIsX ? price : 1 / price;
  if (preview.rangeState !== 'in_range' || !priceAgrees(preview.price, expected)) return fail(409, 'STOCK_PIER_PRICE', "The pier's price is not the market's now.");
  return {
    ok: true,
    value: reviewed.value,
    builds: preview.rent.some((row) => row.what === 'pool'),
    pool: spot.address,
  };
}
