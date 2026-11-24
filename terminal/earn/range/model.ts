import type { EarnBinsAnswer, EarnBinsRent } from '../../../lib/earn-pools/bins.ts';
import { placedFigure, placesFor, stepSignificant } from '../../ui/figures.ts';

/**
 * A position's range, read for the screen: how many steps of the pool's price it takes each side, where its
 * edges stand as prices and per cent, the pool's liquidity as bars with the range over them, and the facts a person
 * reads before the signature — what the accounts cost and give back, about what the range would have earned in the day
 * gone, and whether the pool's price stands far from the market's.
 *
 * The range is the engine's own: a width in steps each side of the price it reads at the Review (`half`, as the pool's
 * add takes it). Nothing here builds or changes an action; every figure is the chain's, the venue's, or a plain ratio
 * of the two, and what is only «about» is named so.
 *
 * Pure: no store, no wallet, no network.
 */

/** The narrowest range: one step each side. */
export const RANGE_MIN_HALF = 1;
/** The widest one position takes in the engine: 34 steps each side — 69 in all. */
export const RANGE_MAX_HALF = 34;

/** The quick widths a person taps: this many per cent each side of the price. */
export const QUICK_PCTS = [1, 2, 5, 10] as const;

const ratioOf = (stepBps: number) => 1 + stepBps / 10_000;

/** A width held within what one position takes. */
export function clampHalf(half: number, max: number = RANGE_MAX_HALF): number {
  if (!Number.isFinite(half)) return RANGE_MIN_HALF;
  return Math.min(Math.max(RANGE_MIN_HALF, Math.round(half)), Math.max(RANGE_MIN_HALF, max));
}

/** The steps each side that reach `pct` per cent above the price, the nearest whole number of them; never under one. */
export function halfForPct(stepBps: number, pct: number): number {
  if (!(stepBps > 0) || !(pct > 0)) return RANGE_MIN_HALF;
  return Math.max(RANGE_MIN_HALF, Math.round(Math.log(1 + pct / 100) / Math.log(ratioOf(stepBps))));
}

/** How far `half` steps reach each side, per cent of the price: up, and down (a little less — the steps are a ratio). */
export function reachOf(stepBps: number, half: number): Readonly<{ upPct: number; downPct: number }> {
  const ratio = ratioOf(stepBps);
  return { upPct: (ratio ** half - 1) * 100, downPct: (1 - ratio ** -half) * 100 };
}

export type Quick = Readonly<{ pct: number; half: number; /** Whether one position reaches it on this pool. */ fits: boolean }>;

/** The quick widths on a pool: each as the steps it takes, and whether one position holds that many. */
export function quickPicks(stepBps: number, max: number = RANGE_MAX_HALF): Quick[] {
  return QUICK_PCTS.map((pct) => {
    const half = halfForPct(stepBps, pct);
    return { pct, half, fits: half <= max };
  });
}

export type RangeView = Readonly<{
  half: number;
  /** Every step the position holds: both sides and the one the price stands in. */
  steps: number;
  low: number;
  high: number;
  downPct: number;
  upPct: number;
}>;

/**
 * A range of `half` steps each side of a price. Its edges are the edge steps' own prices where the pool's steps were
 * read (`bins`), else counted from the price by the step.
 */
export function rangeView(price: number, stepBps: number, half: number, bins: EarnBinsAnswer['bins'] | null = null): RangeView {
  const ratio = ratioOf(stepBps);
  const read = (offset: number) => bins?.find((bin) => bin.offset === offset)?.price ?? null;
  const low = read(-half) ?? price * ratio ** -half;
  const high = read(half) ?? price * ratio ** half;
  return { half, steps: half * 2 + 1, low, high, downPct: (1 - low / price) * 100, upPct: (high / price - 1) * 100 };
}

/**
 * The same on a pool of ticks (DLMM Pro): a step there is a stretch of prices, and the range ends at the upper edge of
 * its top step — the lower edge of the step after it.
 */
export function stretchView(price: number, stepBps: number, half: number, bins: EarnBinsAnswer['bins'] | null = null): RangeView {
  const ratio = ratioOf(stepBps);
  const read = (offset: number) => bins?.find((bin) => bin.offset === offset)?.price ?? null;
  const here = read(0) ?? price;
  const low = read(-half) ?? here * ratio ** -half;
  const high = read(half + 1) ?? here * ratio ** (half + 1);
  return { half, steps: half * 2 + 1, low, high, downPct: (1 - low / price) * 100, upPct: (high / price - 1) * 100 };
}

export type EdgeTexts = Readonly<{ low: string; now: string; high: string }>;

/**
 * A range's two edges and the price between them, the English way (`digits` makes them the screen's), to
 * as many places as the pool's step needs (`stepFigure`: four significant figures at least, five for a step of 0.01 %),
 * all three to the same places so they read in one column, and more while the two edges would still read alike —
 * never «1.31 – 1.32» for a range of a third of a per cent, never «Min 1.31 = Now 1.31». The price is the pool's own,
 * as the pool's head says it. A run of zeros is folded as the chart folds it (0.0₆1383).
 */
export function edgeTexts(low: number, high: number, now: number, stepBps: number | null): EdgeTexts {
  const least = Math.min(...[low, now].filter((value) => value > 0 && Number.isFinite(value)));
  let places = placesFor(Number.isFinite(least) ? least : high, stepSignificant(stepBps));
  while (places < 14 && low > 0 && high > low && low.toFixed(places) === high.toFixed(places)) places += 1;
  return { low: placedFigure(low, places), now: placedFigure(now, places), high: placedFigure(high, places) };
}

/* ── the pool's liquidity as bars ──────────────────────────────────────────────────────────────────────────────── */

export type Bar = Readonly<{
  offset: number;
  price: number;
  /** The step's worth against the tallest shown, 0…1. */
  height: number;
  /** Which coin lies on the step: Y under the price, X over it, both where the price stands. */
  side: 'x' | 'y' | 'both' | 'none';
  active: boolean;
  inRange: boolean;
}>;

const whole = (raw: string, decimals: number): number => Number(raw) / 10 ** decimals;

/** A step's worth in Y: what lies on it of X at the step's price, and of Y. */
export function binWorth(bin: EarnBinsAnswer['bins'][number], answer: Pick<EarnBinsAnswer, 'x' | 'y'>): number {
  const worth = whole(bin.x, answer.x.decimals) * bin.price + whole(bin.y, answer.y.decimals);
  return Number.isFinite(worth) && worth > 0 ? worth : 0;
}

/** A bar never stands taller than this many times the median step: one deep step does not flatten the rest. */
const TALL_CAP = 6;

/** The steps read around the price as bars, the range marked on them. */
export function barsOf(answer: EarnBinsAnswer, half: number): Bar[] {
  const worths = answer.bins.map((bin) => binWorth(bin, answer));
  const filled = worths.filter((worth) => worth > 0).sort((a, b) => a - b);
  const median = filled.length ? filled[Math.floor(filled.length / 2)]! : 0;
  const top = filled.length ? Math.min(filled[filled.length - 1]!, median * TALL_CAP) : 0;
  return answer.bins.map((bin, index) => {
    const worth = worths[index]!;
    const hasX = /[1-9]/.test(bin.x);
    const hasY = /[1-9]/.test(bin.y);
    return {
      offset: bin.offset,
      price: bin.price,
      height: top > 0 ? Math.min(1, worth / top) : 0,
      side: hasX && hasY ? 'both' : hasX ? 'x' : hasY ? 'y' : 'none',
      active: bin.offset === 0,
      inRange: Math.abs(bin.offset) <= half,
    };
  });
}

/** How far each side the bars reach: the widest offset read. */
export function spanOf(answer: Pick<EarnBinsAnswer, 'bins'>): number {
  return answer.bins.reduce((span, bin) => Math.max(span, Math.abs(bin.offset)), 0);
}

/** A place across the chart (0 — its left edge, 1 — its right) as a width in steps each side of the price. */
export function halfAt(fraction: number, span: number, max: number = RANGE_MAX_HALF): number {
  const columns = span * 2 + 1;
  const offset = Math.floor(Math.min(0.999999, Math.max(0, fraction)) * columns) - span;
  return clampHalf(Math.abs(offset), Math.min(max, span));
}

export type ShapeId = 'spot' | 'curve' | 'bid_ask' | 'wave';

/**
 * How a new position spreads over its steps, for the eye: even, more by the price, more at the edges, or Meteora's Wave
 * — even on the half of each side nearer the price, rising to twice that at the edges — each step's share against the
 * tallest, 0…1. The engine builds the real spread; this is its outline over the pool's bars.
 */
export function shapeAt(shape: ShapeId, offset: number, half: number): number {
  const far = Math.abs(offset);
  if (far > half) return 0;
  if (shape === 'spot' || half === 0) return 1;
  const along = far / half;
  if (shape === 'wave') return along <= 0.5 ? 0.5 : along;
  return shape === 'curve' ? 1 - along * 0.8 : 0.2 + along * 0.8;
}

/* ── the facts before the signature ────────────────────────────────────────────────────────────────────────────── */

/** Everything in the range's steps, in Y — what a new deposit shares the trades' fees with while the price is inside. */
export function rangeWorth(answer: EarnBinsAnswer, half: number): number {
  return answer.bins.reduce((sum, bin) => (Math.abs(bin.offset) <= half ? sum + binWorth(bin, answer) : sum), 0);
}

/**
 * The part of the day gone a range this wide would have held the price: its steps against the steps the price walked
 * between the day's low and high. One — the day's whole walk fits inside; null where the day's prices were not read.
 */
export function heldShare(steps: number, stepBps: number, dayLow: number | null, dayHigh: number | null): number | null {
  if (dayLow === null || dayHigh === null || !(dayLow > 0) || !(dayHigh >= dayLow) || !(stepBps > 0) || !(steps > 0)) return null;
  const walked = Math.log(dayHigh / dayLow) / Math.log(ratioOf(stepBps)) + 1;
  return Math.min(1, steps / walked);
}

/** The lowest and the highest of a line of prices over its last 24 hours (times in seconds); null with fewer than two. */
export function dayMove(points: readonly Readonly<{ t: number; p: number }>[]): Readonly<{ low: number; high: number }> | null {
  const last = points.at(-1);
  if (!last) return null;
  const day = points.filter((point) => point.t >= last.t - 86_400 && point.p > 0);
  if (day.length < 2) return null;
  return { low: Math.min(...day.map((point) => point.p)), high: Math.max(...day.map((point) => point.p)) };
}

export type DayEstimate = Readonly<{ dayUsd: number; sharePct: number; /** What the share is of: the range at the day's move, or the whole pool. */ basis: 'range' | 'pool' }>;

/**
 * About what the deposit would have been paid in the day gone: what trades paid the pool's liquidity in 24 hours,
 * times the deposit's share of what lies in the range's steps, times the part of that day a range this wide would have
 * held the price (`held`). A narrow range holds a larger share for a shorter time; outside it nothing is paid. Where
 * the day's prices or the range's liquidity were not read it is the plain share of the whole pool — the careful
 * figure, and said as that. Null where a figure it stands on was not read, or nothing lies in the range to share with.
 */
export function dayEstimate(input: Readonly<{ lpFees24hUsd: number | null; depositUsd: number | null; rangeUsd: number | null; poolUsd: number | null; held: number | null }>): DayEstimate | null {
  const { lpFees24hUsd, depositUsd, rangeUsd, poolUsd, held } = input;
  if (lpFees24hUsd === null || depositUsd === null || !(lpFees24hUsd >= 0) || !(depositUsd > 0)) return null;
  let share: number;
  let basis: DayEstimate['basis'];
  if (held !== null && held >= 0 && held <= 1 && rangeUsd !== null) {
    if (!(rangeUsd > 0)) return null;
    share = held * (depositUsd / (rangeUsd + depositUsd));
    basis = 'range';
  } else {
    if (poolUsd === null || !(poolUsd > 0)) return null;
    share = depositUsd / (poolUsd + depositUsd);
    basis = 'pool';
  }
  const dayUsd = lpFees24hUsd * share;
  return Number.isFinite(dayUsd) ? { dayUsd, sharePct: share * 100, basis } : null;
}

export type RentView = Readonly<{
  /** Everything the accounts take, lamports. */
  pay: bigint;
  /** The part that comes back when the position is closed. */
  back: bigint;
  /** Shared ledgers the position names that nobody opened yet: opening them stays with the pool. */
  ledgers: number;
}>;

/**
 * What a new position of the range pays for its accounts and gets back, from the pool's own facts; null without them.
 * A position names the shared ledger its lowest step is in and the one after it — the engine's own rule — and opens
 * whichever of the two nobody opened yet.
 */
export function rentView(rent: EarnBinsRent | null, activeId: number, half: number): RentView | null {
  if (!rent || !/^\d+$/.test(rent.positionLamports) || !/^\d+$/.test(rent.ledgerLamports)) return null;
  const low = activeId - half;
  const first = rent.ledgers.find((ledger) => ledger.lower <= low && low <= ledger.upper);
  // The ledgers were not read where the range starts: the Review alone can say.
  if (!first) return null;
  const next = rent.ledgers.find((ledger) => ledger.lower === first.upper + 1);
  if (!next) return null;
  const ledgers = [first, next].filter((ledger) => !ledger.open).length;
  const back = BigInt(rent.positionLamports);
  return { pay: back + BigInt(rent.ledgerLamports) * BigInt(ledgers), back, ledgers };
}

/** From this far the pool's price is said to stand away from the market's: one per cent, or two of the pool's steps. */
const GAP_FLOOR_PCT = 1;

export type GapView = Readonly<{ pct: number; far: boolean; dearer: boolean }>;

/** How far the pool's price stands from the market's, and whether that is worth a line before the signature. */
export function gapView(gapPct: number | null, stepBps: number): GapView | null {
  if (gapPct === null || !Number.isFinite(gapPct)) return null;
  const floor = Math.max(GAP_FLOOR_PCT, (stepBps / 100) * 2);
  return { pct: Math.abs(gapPct), far: Math.abs(gapPct) >= floor, dearer: gapPct > 0 };
}

/** A per cent for the eye: «1.37», «0.2», «12» — two places under ten, one under a hundred. */
export function pctText(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const abs = Math.abs(pct);
  return abs >= 100 ? abs.toFixed(0) : abs >= 10 ? String(Number(abs.toFixed(1))) : String(Number(abs.toFixed(2)));
}
