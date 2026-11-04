/**
 * The ladder composer (B5, CITY-135) — the pure part: a buy or an exit ladder
 * as Meteora DLMM limit-order bins.
 *
 * A **buy ladder** spends the quote (a dollar) in steps under the price; an
 * **exit ladder** sells the base the person already holds in steps over it.
 * Each step is one bin of a DLMM limit order: when the price crosses the bin,
 * the pool converts that step at the bin's own price and it stays converted —
 * no keeper, no Ryntra key; only the person's signature cancels it and takes
 * the rest back (`lib/solana/limits/model.ts`).
 *
 * Steps are kept as percents from the price the ladder is placed at, the way
 * the window's drafts keep them (`city/lib/bots/draft.ts`), and become bins
 * here: a buy's bin is rounded to the person's side (never above the step's
 * price), an exit's likewise (never below it). A step that would sit on the
 * active bin or across it moves to the nearest bin on its own side — a limit
 * order on the wrong side of the market is a market order in disguise. Two
 * steps that land in one bin become one.
 *
 * A limit order takes at most 50 bins, and one transaction carries only a few
 * of the pool's bin arrays, so a ladder is cut into transactions by bin array
 * (`chunkRungs`); every transaction is its own order account. The person signs
 * them together, once.
 *
 * Pure and client-safe: no network, no `process.env`, no clock. The window and
 * the server compute the same plan from the same pool facts.
 */

import { DLMM_LIMIT_MAX_BINS, dlmmIsAskSide } from "../../solana/limits/model.ts";

export const LADDER_SIDES = ["buy", "exit"] as const;
export type LadderSide = (typeof LADDER_SIDES)[number];

/**
 * How the amount spreads over the steps:
 * - `even` — the same amount on every step;
 * - `deeper` — more on the far steps: a buy ladder buys more the lower it goes, an exit ladder sells more the higher.
 */
export const LADDER_SHAPES = ["even", "deeper"] as const;
export type LadderShape = (typeof LADDER_SHAPES)[number];

export const LADDER_MIN_STEPS = 2;
export const LADDER_MAX_STEPS = 12;
/** The furthest a step may sit: a buy at most 90 % under the price, an exit at most 5× over it. */
export const BUY_MAX_PCT = 90;
export const EXIT_MAX_PCT = 400;
/** Bins per bin array of a DLMM pool (`MAX_BIN_PER_ARRAY`). */
export const BINS_PER_ARRAY = 70;
/** The default bin-array bitmap covers indexes −512 … 511; beyond it the pool needs its bitmap extension. */
export const DEFAULT_BITMAP_HALF = 512;
/** Bin arrays one transaction carries, with their creation if missing: kept small so a legacy transaction fits. */
export const MAX_ARRAYS_PER_TX = 2;
/** And the transactions one leg may take; a ladder needing more is refused, not half-placed. */
export const MAX_TX_PER_LEG = 4;
/** The least one step carries, in dollars: below it a step is dust. */
export const MIN_STEP_USD = 1;

/** What the plan needs of a pool, read on chain. */
export type LadderPool = Readonly<{
  pool: string;
  binStep: number;
  activeId: number;
  /** The person's base is the pool's X. */
  baseIsX: boolean;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
}>;

export type LadderLeg = Readonly<{
  side: LadderSide;
  steps: number;
  /** The nearest step, percent from the price. */
  firstPct: number;
  /** The furthest step, percent from the price. */
  lastPct: number;
  shape: LadderShape;
  /** What leaves the wallet, raw units of the input: the quote for a buy, the base for an exit. */
  amountRaw: string;
}>;

export type Rung = Readonly<{
  binId: number;
  /** Quote per base the bin converts at — the step's real price. */
  price: number;
  /** Signed, percent from the price the ladder is placed at: a buy's below (negative), an exit's above. */
  pct: number;
  /** Raw units of the input placed in the bin. */
  amountRaw: string;
}>;

export type LegPlan = Readonly<{
  side: LadderSide;
  /** The pool's own side of the order: an ask sells X for Y. */
  isAskSide: boolean;
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  /** Quote per base at the active bin. */
  refPrice: number;
  /** Nearest the price first. */
  rungs: readonly Rung[];
  /** Steps asked for; `rungs` may be fewer where two steps share a bin. */
  asked: number;
  /** Rungs moved off the active bin to their own side. */
  moved: number;
  totalRaw: string;
}>;

export type LadderIssue =
  | "steps"
  | "percent"
  | "amount"
  | "too_many_bins"
  | "step_too_small"
  | "too_many_transactions";

/* ------------------------------------------------------------------ prices */

/** Y per X of a bin, per lamport: (1 + step / 10 000)^id. */
export function binPoolPricePerLamport(binId: number, binStep: number): number {
  return (1 + binStep / 10_000) ** binId;
}

/** Quote per base of a bin, in whole tokens. */
export function binPrice(binId: number, pool: Pick<LadderPool, "binStep" | "baseIsX" | "baseDecimals" | "quoteDecimals">): number {
  const perLamport = binPoolPricePerLamport(binId, pool.binStep);
  /* Y per X in whole tokens = per-lamport × 10^(xDecimals − yDecimals). */
  const xDecimals = pool.baseIsX ? pool.baseDecimals : pool.quoteDecimals;
  const yDecimals = pool.baseIsX ? pool.quoteDecimals : pool.baseDecimals;
  const poolPrice = perLamport * 10 ** (xDecimals - yDecimals);
  return pool.baseIsX ? poolPrice : 1 / poolPrice;
}

/**
 * The bin of a quote-per-base price, rounded the person's way: an ask (selling X) rounds its pool price up, a bid
 * (buying X) down — so a step never converts at a worse price than it says.
 */
export function binOfPrice(price: number, isAskSide: boolean, pool: Pick<LadderPool, "binStep" | "baseIsX" | "baseDecimals" | "quoteDecimals">): number {
  const xDecimals = pool.baseIsX ? pool.baseDecimals : pool.quoteDecimals;
  const yDecimals = pool.baseIsX ? pool.quoteDecimals : pool.baseDecimals;
  const poolPrice = pool.baseIsX ? price : 1 / price;
  const perLamport = poolPrice / 10 ** (xDecimals - yDecimals);
  const exact = Math.log(perLamport) / Math.log(1 + pool.binStep / 10_000);
  /* A hair of tolerance: a price typed exactly on a bin's edge stays in that bin. */
  return isAskSide ? Math.ceil(exact - 1e-9) : Math.floor(exact + 1e-9);
}

export const binArrayIndex = (binId: number): number => Math.floor(binId / BINS_PER_ARRAY);

export const needsBitmapExtension = (arrayIndex: number): boolean => arrayIndex < -DEFAULT_BITMAP_HALF || arrayIndex >= DEFAULT_BITMAP_HALF;

/* ----------------------------------------------------------------- amounts */

/** `steps` evenly spaced percents from `first` to `last`. */
export function stepPercents(first: number, last: number, steps: number): number[] {
  if (steps <= 1) return [first];
  return Array.from({ length: steps }, (_, i) => first + ((last - first) * i) / (steps - 1));
}

/** Weights of the steps, nearest first. */
export function shapeWeights(shape: LadderShape, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => (shape === "deeper" ? i + 1 : 1));
}

/** A raw total split by weights, exactly: each part rounded down, what is left over on the furthest step. */
export function splitRaw(totalRaw: bigint, weights: readonly number[]): bigint[] {
  if (weights.length === 0 || totalRaw <= 0n) return weights.map(() => 0n);
  const scaled = weights.map((w) => BigInt(Math.max(0, Math.round(w * 1000))));
  const sum = scaled.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const parts = scaled.map((w) => (totalRaw * w) / sum);
  const used = parts.reduce((a, b) => a + b, 0n);
  parts[parts.length - 1] = parts[parts.length - 1]! + (totalRaw - used);
  return parts;
}

/**
 * What a dollar amount is in raw units of a leg's input, at the active bin's price. The quote of a ladder is a dollar
 * (the server holds the pool to a dollar quote), so a buy's amount is the quote itself; an exit's is the base the
 * amount buys at the price now.
 */
export function legAmountRaw(side: LadderSide, amountUsd: number, refPrice: number, pool: Pick<LadderPool, "baseDecimals" | "quoteDecimals">): string {
  if (!(amountUsd > 0) || !Number.isFinite(amountUsd)) return "0";
  if (side === "buy") return BigInt(Math.floor(amountUsd * 10 ** pool.quoteDecimals)).toString();
  if (!(refPrice > 0)) return "0";
  return BigInt(Math.floor((amountUsd / refPrice) * 10 ** pool.baseDecimals)).toString();
}

/** A leg's raw amount in dollars, at the price now. */
export function legUsd(side: LadderSide, amountRaw: string | bigint, refPrice: number, pool: Pick<LadderPool, "baseDecimals" | "quoteDecimals">): number {
  const raw = Number(typeof amountRaw === "bigint" ? amountRaw : BigInt(/^\d+$/.test(amountRaw) ? amountRaw : "0"));
  return side === "buy" ? raw / 10 ** pool.quoteDecimals : (raw / 10 ** pool.baseDecimals) * refPrice;
}

/* -------------------------------------------------------------------- plan */

export function legIssues(leg: LadderLeg): LadderIssue[] {
  const issues: LadderIssue[] = [];
  if (!(Number.isInteger(leg.steps) && leg.steps >= LADDER_MIN_STEPS && leg.steps <= LADDER_MAX_STEPS)) issues.push("steps");
  const max = leg.side === "buy" ? BUY_MAX_PCT : EXIT_MAX_PCT;
  if (!(Number.isFinite(leg.firstPct) && Number.isFinite(leg.lastPct) && leg.firstPct > 0 && leg.lastPct > leg.firstPct && leg.lastPct <= max)) issues.push("percent");
  if (!/^\d{1,30}$/.test(leg.amountRaw) || BigInt(leg.amountRaw) <= 0n) issues.push("amount");
  return issues;
}

/**
 * A leg as bins of a pool: one rung per step, nearest the price first, the amount split by the shape. Null when the
 * leg itself does not pass (`legIssues`).
 */
export function planLeg(leg: LadderLeg, pool: LadderPool): LegPlan | null {
  if (legIssues(leg).length) return null;
  const isAskSide = dlmmIsAskSide(leg.side === "buy" ? "buy" : "sell", pool.baseIsX);
  const refPrice = binPrice(pool.activeId, pool);
  const percents = stepPercents(leg.firstPct, leg.lastPct, leg.steps);
  const parts = splitRaw(BigInt(leg.amountRaw), shapeWeights(leg.shape, leg.steps));
  /* Bins above the active one hold X for sale (ask); below it, Y waiting to buy X (bid). */
  const below = (binId: number) => binId < pool.activeId;
  let moved = 0;
  const byBin = new Map<number, { amount: bigint; order: number }>();
  percents.forEach((pct, i) => {
    const target = leg.side === "buy" ? refPrice * (1 - pct / 100) : refPrice * (1 + pct / 100);
    let binId = binOfPrice(target, isAskSide, pool);
    if (isAskSide ? binId <= pool.activeId : binId >= pool.activeId) {
      binId = isAskSide ? pool.activeId + 1 : pool.activeId - 1;
      moved += 1;
    }
    /* An ask sits above the active bin, a bid below — whichever token is the base. */
    if (isAskSide === below(binId)) return;
    const have = byBin.get(binId);
    byBin.set(binId, { amount: (have?.amount ?? 0n) + parts[i]!, order: have?.order ?? i });
  });
  const rungs = [...byBin.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([binId, { amount }]) => {
      const price = binPrice(binId, pool);
      return { binId, price, pct: ((price - refPrice) / refPrice) * 100, amountRaw: amount.toString() };
    });
  const inputIsBase = leg.side === "exit";
  return {
    side: leg.side,
    isAskSide,
    inputMint: inputIsBase ? pool.baseMint : pool.quoteMint,
    outputMint: inputIsBase ? pool.quoteMint : pool.baseMint,
    inputDecimals: inputIsBase ? pool.baseDecimals : pool.quoteDecimals,
    refPrice,
    rungs,
    asked: leg.steps,
    moved,
    totalRaw: leg.amountRaw,
  };
}

/** The rungs of a leg cut into transactions: by bin array, at most `MAX_ARRAYS_PER_TX` arrays each, nearest first. */
export function chunkRungs(rungs: readonly Rung[], maxArrays = MAX_ARRAYS_PER_TX): Rung[][] {
  const chunks: Rung[][] = [];
  let current: Rung[] = [];
  let arrays = new Set<number>();
  for (const rung of rungs) {
    const index = binArrayIndex(rung.binId);
    if (!arrays.has(index) && arrays.size >= maxArrays) {
      chunks.push(current);
      current = [];
      arrays = new Set();
    }
    arrays.add(index);
    current.push(rung);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** The bin arrays a set of rungs touches. */
export function arraysOf(rungs: readonly Rung[]): number[] {
  return [...new Set(rungs.map((rung) => binArrayIndex(rung.binId)))].sort((a, b) => a - b);
}

/** What is wrong with a planned leg, beyond its own settings: bins, dust, transactions. */
export function planIssues(plan: LegPlan, pool: LadderPool): LadderIssue[] {
  const issues: LadderIssue[] = [];
  if (plan.rungs.length > DLMM_LIMIT_MAX_BINS) issues.push("too_many_bins");
  const smallest = plan.rungs.reduce((min, rung) => Math.min(min, legUsd(plan.side, rung.amountRaw, plan.refPrice, pool)), Infinity);
  if (plan.rungs.length === 0 || smallest < MIN_STEP_USD) issues.push("step_too_small");
  if (chunkRungs(plan.rungs).length > MAX_TX_PER_LEG) issues.push("too_many_transactions");
  return issues;
}

/**
 * The band a ladder works in, quote per base, from its rungs and the price it was placed at — leaving it is what the
 * exit policy answers. A buy ladder: from 5 % under its lowest step to 10 % over the start (the price ran away
 * before anything filled). An exit ladder: from 15 % under the start to 5 % over its highest step.
 */
export function bandOfPlan(plan: Pick<LegPlan, "side" | "rungs" | "refPrice">): Readonly<{ lower: number; upper: number }> | null {
  if (!plan.rungs.length || !(plan.refPrice > 0)) return null;
  const prices = plan.rungs.map((rung) => rung.price);
  if (plan.side === "buy") return { lower: Math.min(...prices) * 0.95, upper: plan.refPrice * 1.1 };
  return { lower: plan.refPrice * 0.85, upper: Math.max(...prices) * 1.05 };
}
