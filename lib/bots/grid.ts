/**
 * The grid of «Боти» on Meteora DLMM: a pool's bins are
 * already a grid on the chain. Each bin is one price level, one step of the
 * pool's bin step above the last; liquidity spread evenly over a run of bins
 * (DLMM's `spot` shape) is a buy order at every level below the price and a
 * sell order at every level above it, and the pool fills them both ways as the
 * price moves — earning the pool's fee on each fill.
 *
 * So a grid is one DLMM position, placed and collected through the pools'
 * own Review, ticket and relay (`lib/liquidity/studio/actions.ts`): the
 * person's wallet signs; no delegate, no durable nonce, no key of a server
 * that moves money. This file is the strategy only — which bins, how much per
 * level, and the bot's one number — and builds nothing.
 *
 * Pure and client-safe. Floats are for reading; the money sent is the
 * person's base units, as the pools' form makes them.
 */

import type { CatalogPool } from "../liquidity/catalog/model.ts";
import type { PositionView } from "../liquidity/catalog/positions.ts";
import { positionResult, type PositionEntry } from "../liquidity/catalog/track.ts";

/** `buy` — levels below the price, paid in the quote token; `sell` — above it, the base token; `both` — across it. */
export const GRID_SIDES = ["buy", "sell", "both"] as const;
export type GridSide = (typeof GRID_SIDES)[number];

/** Where the pools' Review places the bins for a side, counted from the active bin it reads itself. */
export const GRID_PLACE: Readonly<Record<GridSide, "below" | "above" | "around">> = { buy: "below", sell: "above", both: "around" };

/**
 * The number of levels a person may choose: always odd, as the pools' Review counts a range by its half-width
 * (`2 × half + 1` bins), and at most 69 — the widest range one position holds in one transaction.
 */
export const GRID_LEVELS = [11, 21, 41, 69] as const;
export type GridLevels = (typeof GRID_LEVELS)[number];
export const DEFAULT_GRID_LEVELS: GridLevels = 21;

export function isGridLevels(value: unknown): value is GridLevels {
  return typeof value === "number" && (GRID_LEVELS as readonly number[]).includes(value);
}

/** The half-width the Review takes for a number of levels. */
export function gridHalf(levels: GridLevels): number {
  return (levels - 1) / 2;
}

/** The bins of a grid from the active bin, inclusive — the same count `binsFrom` in the pools' Review makes. */
export function gridBins(activeBin: number, side: GridSide, levels: GridLevels): Readonly<{ lower: number; upper: number }> {
  const half = gridHalf(levels);
  if (side === "sell") return { lower: activeBin + 1, upper: activeBin + 1 + 2 * half };
  if (side === "buy") return { lower: activeBin - 1 - 2 * half, upper: activeBin - 1 };
  return { lower: activeBin - half, upper: activeBin + half };
}

/** Which tokens a side takes: X (the base) sells above the price, Y (the quote) buys below it. */
export function gridSides(side: GridSide): Readonly<{ x: boolean; y: boolean }> {
  return side === "sell" ? { x: true, y: false } : side === "buy" ? { x: false, y: true } : { x: true, y: true };
}

export type GridPlanInput = Readonly<{
  activeBin: number;
  binStepBps: number;
  /** Y per one X now. */
  price: number;
  side: GridSide;
  levels: GridLevels;
  /** What the person puts in, each token's own unit; the side's other token is ignored. */
  amountX: number;
  amountY: number;
}>;

export type GridPlan = Readonly<{
  side: GridSide;
  levels: GridLevels;
  bins: Readonly<{ lower: number; upper: number }>;
  /** The lowest and the highest level, Y per X. */
  lowerPrice: number;
  upperPrice: number;
  /** One level's distance from the next, percent. */
  stepPct: number;
  /** How far the lowest level is below the price and the highest above it, percent; 0 where the grid does not reach. */
  downPct: number;
  upPct: number;
  /** Levels that buy (below the price) and that sell (above it); `both` shares the price's own level. */
  buyLevels: number;
  sellLevels: number;
  /** About what each level holds: X on a selling level, Y on a buying one (DLMM's `spot` shape spreads evenly). */
  perLevel: Readonly<{ x: number; y: number }>;
}>;

const finite = (value: number) => Number.isFinite(value);

/** The grid a choice makes at the pool's price now; null when the pool's figures are not a grid. */
export function planGrid(input: GridPlanInput): GridPlan | null {
  const { activeBin, binStepBps, price, side, levels } = input;
  if (!Number.isInteger(activeBin) || !(binStepBps > 0) || !(price > 0) || !finite(price) || !isGridLevels(levels)) return null;
  const step = 1 + binStepBps / 10_000;
  const bins = gridBins(activeBin, side, levels);
  const at = (bin: number) => price * step ** (bin - activeBin);
  const lowerPrice = at(bins.lower);
  const upperPrice = at(bins.upper);
  const sides = gridSides(side);
  /* With `both` the price's own bin holds some of each; X spreads over it and the bins above, Y over it and below. */
  const sellLevels = side === "buy" ? 0 : side === "sell" ? levels : gridHalf(levels) + 1;
  const buyLevels = side === "sell" ? 0 : side === "buy" ? levels : gridHalf(levels) + 1;
  const x = sides.x && finite(input.amountX) && input.amountX > 0 ? input.amountX / sellLevels : 0;
  const y = sides.y && finite(input.amountY) && input.amountY > 0 ? input.amountY / buyLevels : 0;
  return {
    side,
    levels,
    bins,
    lowerPrice,
    upperPrice,
    stepPct: binStepBps / 100,
    downPct: lowerPrice < price ? (1 - lowerPrice / price) * 100 : 0,
    upPct: upperPrice > price ? (upperPrice / price - 1) * 100 : 0,
    buyLevels,
    sellLevels,
    perLevel: { x, y },
  };
}

/** The pools the grid's choice shows: the deepest trading first, enough to find a pair without a wall. */
export const GRID_POOL_ROWS = 24;

/** The pools a grid can stand in: DLMM — its bins are the levels — listed by the venue, with a step and a price. */
export function gridPools(pools: readonly CatalogPool[]): CatalogPool[] {
  return pools
    .filter((pool) => pool.kind === "dlmm" && !pool.blacklisted && pool.binStepBps !== null && pool.binStepBps > 0 && pool.price !== null && pool.price > 0)
    .sort((a, b) => (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) || a.address.localeCompare(b.address))
    .slice(0, GRID_POOL_ROWS);
}

/* ------------------------------------------------------------------ the bot */

/**
 * A grid as «Мої боти» keeps it: the position it is, and what the person chose. The chain holds the position; it does
 * not know it is a grid, so the browser that placed it keeps this beside the pools' entry of what went in
 * (`app/app/markets/pools/position-entries.ts`). Another browser shows the position in «Пули», not here.
 */
export type GridBot = Readonly<{
  position: string;
  pool: string;
  /** «SOL/USDC», as the page named the pool. */
  pair: string;
  side: GridSide;
  levels: GridLevels;
  lowerPrice: number;
  upperPrice: number;
  /** ms, when the placement landed. */
  at: number;
  /** The server's time of the first read that no longer held the position; a later read without it closes the bot. */
  missedAt?: number;
}>;

const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A bot as stored, checked field by field: anything else is no bot. */
export function readGridBot(raw: unknown): GridBot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const { position, pool, pair, side, levels, lowerPrice, upperPrice, at } = value;
  if (typeof position !== "string" || !KEY.test(position) || typeof pool !== "string" || !KEY.test(pool)) return null;
  if (typeof pair !== "string" || pair.length === 0 || pair.length > 80) return null;
  if (typeof side !== "string" || !(GRID_SIDES as readonly string[]).includes(side) || !isGridLevels(levels)) return null;
  const positive = (n: unknown): n is number => typeof n === "number" && finite(n) && n > 0;
  if (!positive(lowerPrice) || !positive(upperPrice) || upperPrice < lowerPrice || !positive(at)) return null;
  const missed = value.missedAt;
  const bot: GridBot = { position, pool, pair, side: side as GridSide, levels, lowerPrice, upperPrice, at };
  return positive(missed) ? { ...bot, missedAt: missed } : bot;
}

/** How long after it landed a grid may still be missing from the chain's read of the wallet before it counts as closed. */
export const GRID_SETTLE_MS = 5 * 60_000;

export type GridState = "working" | "waiting" | "all_bought" | "all_sold" | "closed";

/**
 * Where the bot stands. Working while the price is inside its levels. Off them the position is one token: below the
 * lowest level every level holds the base token — a buying grid has bought it all, a selling one waits for the price
 * to rise to its levels; above the highest every level holds the quote — sold all, or a buying grid waiting for the
 * price to fall. Closed when the wallet's read has no such position any more — stopped here or elsewhere. Null — not
 * read yet, or too fresh to tell.
 */
export function gridState(bot: GridBot, view: PositionView | null, read: Readonly<{ at: number }> | null): GridState | null {
  if (view) {
    if (view.rangeState === "in_range") return "working";
    /* `above` — the position sits above the price, so it holds only X; `below` — only Y. */
    if (view.rangeState === "above") return bot.side === "sell" ? "waiting" : "all_bought";
    return bot.side === "buy" ? "waiting" : "all_sold";
  }
  if (!read || read.at - bot.at < GRID_SETTLE_MS) return null;
  return "closed";
}

export type GridResult = Readonly<{
  /** What the position holds now plus every fee it earned, less what went in at its own prices, USD. */
  usd: number;
  pct: number;
  /** Fees earned so far, unclaimed and claimed through Ryntra, USD. */
  feesUsd: number;
}>;

/** The bot's one number: its result since it was placed; null without prices or without the entry of what went in. */
export function gridResult(view: PositionView, entry: PositionEntry | null): GridResult | null {
  const result = positionResult(view, entry);
  if (!result || result.sinceDeposit === null || !entry || entry.usd === null || !(entry.usd > 0)) return null;
  return { usd: result.sinceDeposit, pct: (result.sinceDeposit / entry.usd) * 100, feesUsd: result.fees };
}
