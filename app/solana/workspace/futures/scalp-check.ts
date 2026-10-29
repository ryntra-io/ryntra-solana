/**
 * Scalp Check (PERP-7; spec §8 «Scalp Check — власна функція Ryntra»): what one round trip of a given size costs
 * right now, counted by walking the book that is on screen — the asks to get in and the bids to get out for a long,
 * the other way for a short.
 *
 * The chain it shows, in that order: size → spread → Phoenix's fee and Ryntra's → the slippage getting in and the
 * slippage getting out → the price move that brings the round trip back to nothing. Every one of those numbers comes
 * from the levels Phoenix sent, through the same walk the ticket's preview and the server's Review use
 * (`bookFill` in `lib/phoenix/orders-model.ts`), so three places never disagree about one book. Where the book cannot
 * carry the size, nothing is rounded into a figure that looks fillable: the answer says how much it can carry.
 *
 * It judges cost, depth and uncertainty — never whether a trade is a good idea, and never what it might earn.
 */

import { bestPriceOf, bookFill, builderFeeUsd, perpFeeUsd, priceImpactPercent, type BookLevel, type BookLevels, type PerpSide } from "../../../../lib/phoenix/orders-model.ts";

export type { BookLevels };

/**
 * The rates one round trip pays: Phoenix's two, and Ryntra's builder fee in bps on the part that takes liquidity.
 * Any of them null means «not known» — 0 bps is a builder that takes nothing, which is not the same thing.
 */
export type ScalpRates = Readonly<{ takerRate: number | null; makerRate: number | null; builderBps: number | null }>;

/** One leg of the round trip, as the book fills it. */
export type ScalpLeg = Readonly<{
  /** The best price on the side this leg takes, and what the whole size actually fills at. */
  bestUsd: number;
  averageUsd: number;
  /** The last level the walk reached. */
  worstUsd: number;
  /** How far the average is from the best, against the trader: per cent of the best, never below nothing. */
  slippagePercent: number;
  notionalUsd: number;
  /** Phoenix's fee at its taker rate, and Ryntra's; null when the rate is not known — never counted as zero. */
  phoenixUsd: number | null;
  ryntraUsd: number | null;
}>;

/** How much the book can actually carry on each side, and what that is worth. */
export type ScalpDepth = Readonly<{ entryUnits: number; entryNotionalUsd: number; exitUnits: number; exitNotionalUsd: number }>;

export type ScalpCheck =
  | Readonly<{
      kind: "cost";
      sizeUnits: number;
      /** Best ask less best bid, and the same as a per cent of the middle; null when one side is empty. */
      spreadUsd: number | null;
      spreadPercent: number | null;
      entry: ScalpLeg;
      exit: ScalpLeg;
      /** Both legs taking liquidity: Phoenix's and Ryntra's together; null when a rate is missing. */
      feesUsd: number | null;
      /** The same round trip if both legs rest instead — Phoenix's maker rate, and no builder fee on a maker fill. */
      makerFeesUsd: number | null;
      /** The price move that brings the round trip back to nothing: spread and both slippages out of the book, plus fees. */
      breakEvenUsd: number | null;
      breakEvenPercent: number | null;
      /** The book the figures were counted on had stopped updating. */
      stale: boolean;
      depth: ScalpDepth;
    }>
  | Readonly<{ kind: "thin"; sizeUnits: number; depth: ScalpDepth; stale: boolean }>
  | Readonly<{ kind: "none"; reason: "book" | "size" }>;

const levelsOf = (side: PerpSide, book: BookLevels): readonly BookLevel[] => (side === "long" ? book.asks : book.bids);

/** Everything a side of the book holds: the units across all its levels and what they are worth at their own prices. */
function depthOf(levels: readonly BookLevel[]): Readonly<{ units: number; notionalUsd: number }> {
  let units = 0;
  let notionalUsd = 0;
  for (const level of levels) {
    units += level.size;
    notionalUsd += level.size * level.price;
  }
  return { units, notionalUsd };
}

/** The other side of the round trip: a long gets in on the asks and out on the bids. */
const other = (side: PerpSide): PerpSide => (side === "long" ? "short" : "long");

function legOf(side: PerpSide, sizeUnits: number, fill: Readonly<{ averageUsd: number; worstUsd: number }>, bestUsd: number, rates: ScalpRates): ScalpLeg {
  const notionalUsd = sizeUnits * fill.averageUsd;
  return {
    bestUsd,
    averageUsd: fill.averageUsd,
    worstUsd: fill.worstUsd,
    slippagePercent: Math.max(0, priceImpactPercent(side, fill.averageUsd, bestUsd) ?? 0),
    notionalUsd,
    phoenixUsd: rates.takerRate === null ? null : perpFeeUsd(notionalUsd, rates.takerRate),
    ryntraUsd: rates.builderBps === null ? null : builderFeeUsd(notionalUsd, rates.builderBps),
  };
}

const add = (...parts: readonly (number | null)[]): number | null => parts.reduce<number | null>((sum, part) => (sum === null || part === null ? null : sum + part), 0);

/**
 * The cost of getting into a position of this size and straight back out, on the book as it stands.
 *
 * The break-even move is the whole of it: a long fills on the asks at `entry.averageUsd` and would leave on the bids
 * at `exit.averageUsd`, so the position starts that far behind — the spread and both walks' slippage together — and
 * the fees of both legs sit on top. The market has to move that much in the position's favour before the round trip
 * is back at nothing. It is an estimate of this moment's book, not a promise about the next one.
 */
export function scalpCheck(
  input: Readonly<{ side: PerpSide; sizeUnits: number; book: BookLevels | null; rates: ScalpRates; stale?: boolean }>,
): ScalpCheck {
  const { side, sizeUnits, book, rates } = input;
  const stale = input.stale ?? false;
  if (!book || (book.asks.length === 0 && book.bids.length === 0)) return { kind: "none", reason: "book" };
  if (!Number.isFinite(sizeUnits) || !(sizeUnits > 0)) return { kind: "none", reason: "size" };

  const out = other(side);
  const entryDepth = depthOf(levelsOf(side, book));
  const exitDepth = depthOf(levelsOf(out, book));
  const depth: ScalpDepth = { entryUnits: entryDepth.units, entryNotionalUsd: entryDepth.notionalUsd, exitUnits: exitDepth.units, exitNotionalUsd: exitDepth.notionalUsd };

  const entryFill = bookFill(side, sizeUnits, book);
  const exitFill = bookFill(out, sizeUnits, book);
  /* A side that cannot carry the size is said with the figures it can carry, not rounded down to look fillable. */
  if (entryFill === null || entryFill === "thin" || exitFill === null || exitFill === "thin") return { kind: "thin", sizeUnits, depth, stale };

  const bestEntry = bestPriceOf(side, book);
  const bestExit = bestPriceOf(out, book);
  if (bestEntry === null || bestExit === null) return { kind: "thin", sizeUnits, depth, stale };

  const entry = legOf(side, sizeUnits, entryFill, bestEntry, rates);
  const exit = legOf(out, sizeUnits, exitFill, bestExit, rates);

  const bestAsk = book.asks[0]?.price ?? null;
  const bestBid = book.bids[0]?.price ?? null;
  const spreadUsd = bestAsk !== null && bestBid !== null && bestAsk > bestBid ? bestAsk - bestBid : null;
  const middle = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;
  const spreadPercent = spreadUsd !== null && middle !== null && middle > 0 ? (spreadUsd / middle) * 100 : null;

  const feesUsd = add(entry.phoenixUsd, entry.ryntraUsd, exit.phoenixUsd, exit.ryntraUsd);
  /* A fill that rests pays Phoenix's maker rate and brings the builder nothing (`feeSplitOf`). */
  const makerFeesUsd = rates.makerRate === null ? null : add(perpFeeUsd(entry.notionalUsd, rates.makerRate), perpFeeUsd(exit.notionalUsd, rates.makerRate));

  const gap = Math.abs(entry.averageUsd - exit.averageUsd);
  const breakEvenUsd = feesUsd === null ? null : gap + feesUsd / sizeUnits;
  const breakEvenPercent = breakEvenUsd === null || !(entry.averageUsd > 0) ? null : (breakEvenUsd / entry.averageUsd) * 100;

  return { kind: "cost", sizeUnits, spreadUsd, spreadPercent, entry, exit, feesUsd, makerFeesUsd, breakEvenUsd, breakEvenPercent, stale, depth };
}

/** The size a typed amount of dollars stands for at a price; null for anything that is not a positive amount. */
export function scalpUnits(usd: number | null, priceUsd: number | null): number | null {
  if (usd === null || priceUsd === null || !(usd > 0) || !(priceUsd > 0)) return null;
  return usd / priceUsd;
}
