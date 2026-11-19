import type { EarnBinsAnswer } from '../../lib/earn-pools/bins.ts';
import { stepFigure } from '../ui/figures.ts';
import { byDepth, quietReason, type ProPoolRow } from '../../lib/pro-pools/model.ts';
import { lookalikeOf } from '../../lib/world/text-safety/lookalike.ts';

/**
 * What a DLMM Pro pool's screens count from the engine's reads, and nothing more: the columns of «Liquidity
 * by price» in the coin's own terms, and a basis-point figure as a per cent. Pure: the screens and the tests read it alike.
 */

export type DistColumn = Readonly<{
  id: number;
  /** The coin's price at the step, in the coin it is priced in. */
  price: number;
  /** What lies on the step against the deepest step, 0…1. */
  share: number;
  /** Of what lies on the step, the part in the coin itself, 0…1. */
  coinShare: number;
  /** Which coin the step holds: the coin itself (over the price), the coin it is priced in (under it), or both (the price's own step). */
  side: 'coin' | 'quote' | 'both';
}>;

export type DistView = Readonly<{ columns: readonly DistColumn[]; price: number; low: number; high: number; herePct: number }>;

/** Steps kept on each side of what holds liquidity, and the fewest columns a view draws. */
const MARGIN = 3;
const FEWEST = 21;

/**
 * The pool's steps as columns in the coin's own terms, cheapest first: the span of the steps that hold liquidity with a
 * few empty ones on each side, never fewer than `FEWEST` around the price. `side` — the coin's side of the pool. Null
 * where the read holds no step or no price.
 */
export function distributionOf(answer: EarnBinsAnswer, side: 'x' | 'y'): DistView | null {
  if (!answer.bins.length || !(answer.price > 0)) return null;
  const dx = 10 ** answer.x.decimals;
  const dy = 10 ** answer.y.decimals;
  const raw = answer.bins.map((bin) => {
    const xw = Number(bin.x) / dx;
    const yw = Number(bin.y) / dy;
    const coinAmount = side === 'x' ? xw : yw;
    const quoteAmount = side === 'x' ? yw : xw;
    const price = side === 'x' ? bin.price : bin.price > 0 ? 1 / bin.price : 0;
    const inCoin = coinAmount * price;
    const value = inCoin + quoteAmount;
    return { id: bin.id, offset: bin.offset, price, value: Number.isFinite(value) ? value : 0, coinShare: value > 0 ? inCoin / value : 0 };
  });
  // Cheapest first: for the coin as Y the pool's higher steps are the coin's cheaper prices.
  const ordered = side === 'x' ? [...raw].sort((a, b) => a.offset - b.offset) : [...raw].sort((a, b) => b.offset - a.offset);
  const here = Math.max(0, ordered.findIndex((bin) => bin.offset === 0));
  const held = ordered.flatMap((bin, index) => (bin.value > 0 ? [index] : []));
  let from = held.length ? Math.min(held[0]!, here) - MARGIN : here - Math.floor(FEWEST / 2);
  let to = held.length ? Math.max(held.at(-1)!, here) + MARGIN : here + Math.floor(FEWEST / 2);
  if (to - from + 1 < FEWEST) {
    const more = FEWEST - (to - from + 1);
    from -= Math.ceil(more / 2);
    to += Math.floor(more / 2);
  }
  from = Math.max(0, from);
  to = Math.min(ordered.length - 1, to);
  const shown = ordered.slice(from, to + 1);
  const top = shown.reduce((most, bin) => Math.max(most, bin.value), 0);
  const columns: DistColumn[] = shown.map((bin) => ({
    id: bin.id,
    price: bin.price,
    share: top > 0 ? bin.value / top : 0,
    coinShare: bin.coinShare,
    side: bin.offset === 0 ? 'both' : bin.coinShare >= 0.5 ? 'coin' : 'quote',
  }));
  const at = Math.max(0, Math.min(columns.length - 1, here - from));
  const price = side === 'x' ? answer.price : 1 / answer.price;
  return { columns, price, low: columns[0]!.price, high: columns.at(-1)!.price, herePct: ((at + 0.5) / columns.length) * 100 };
}

/**
 * A price of one coin in another, short: as many figures as the pool's step needs to tell its neighbouring steps apart
 * — four at least (0.003645, 72.55), five on a step of 0.01 % (1.3108) — and a run of zeros folded as the chart folds
 * it (0.0₆1383), never «1.383e-7». The pool's head, its liquidity and its ticket say the price alike.
 */
export function quoteFigure(value: number, stepBps: number | null = null): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return stepFigure(value, stepBps);
}

/** Basis points as a per cent, with no more decimals than it needs: 60 → «0.6%», 150 → «1.5%», 1 → «0.01%». */
export function pctOfBps(bps: number): string {
  const pct = bps / 100;
  const places = pct >= 10 ? 1 : pct >= 0.1 ? 2 : 3;
  return `${Number(pct.toFixed(places))}%`;
}

/* ── the list of DLMM Pro's pools ─────────────────────────────────────────────────────────────────────── */

/** Both coins of the pool verified by the catalogue. */
export const proVerified = (row: Pick<ProPoolRow, 'x' | 'y'>): boolean => row.x.verified === true && row.y.verified === true;

/** A ticker that passes for a known coin's it is not (`lib/world/text-safety/lookalike.ts`). */
const passesFor = (symbol: string, mint: string): boolean => lookalikeOf(symbol, mint) !== null;

/** Why a pool stays out of «Active»: no name, a test, a crude name, a look-alike ticker; null — nothing. */
export const proQuiet = (row: Pick<ProPoolRow, 'x' | 'y'>) => quietReason(row, passesFor);

export type ProListInput = Readonly<{
  which: 'deep' | 'every';
  /** The pools the city adds to from here: their ticket is the add, with «My shape». */
  adds: (row: ProPoolRow) => boolean;
  /** From this deep, dollars, a pool counts as one that holds liquidity. */
  deepUsd: number;
}>;

/**
 * DLMM Pro's list as `/pro` lays it (the QA of 19.11 night: «першим JitoSOL·SOL з $0 і "Додати" — виглядає зламаним»):
 * first the deepest pool of verified coins — MET/SOL —, then the city's own pools that hold nothing yet, in sight and
 * never first, each saying «Be the first» on its row; then the rest of the verified pools with liquidity, deepest
 * first, then the others. «Active» (`deep`) keeps the pools that hold liquidity or that the city adds to, and leaves
 * out the names a person should not meet first (`proQuiet`); «All» keeps every pool, those names last.
 */
export function proListRows(rows: readonly ProPoolRow[], input: ProListInput): ProPoolRow[] {
  const deep = (row: ProPoolRow) => (row.tvlUsd ?? 0) >= input.deepUsd;
  // A pool of the city's that holds liquidity is a pool like any: it stands by its depth.
  const empty = (row: ProPoolRow) => input.adds(row) && !deep(row);
  const quiet = (row: ProPoolRow) => proQuiet(row) !== null;
  const listed = input.which === 'deep' ? rows.filter((row) => (deep(row) || input.adds(row)) && !quiet(row)) : rows;
  const rank = (row: ProPoolRow) => (deep(row) && proVerified(row) ? 0 : quiet(row) ? 3 : deep(row) ? 1 : 2);
  const ranked = listed.filter((row) => !empty(row)).sort((a, b) => rank(a) - rank(b) || byDepth(a, b));
  const own = listed.filter(empty).sort(byDepth);
  // The first row holds liquidity: the deepest of verified coins, else — where the catalogue verified none — the deepest.
  const lead = ranked[0] && (rank(ranked[0]) === 0 || (rank(ranked[0]) === 1 && input.which === 'deep')) ? ranked.slice(0, 1) : [];
  return [...lead, ...own, ...ranked.slice(lead.length)];
}

/** Whether a row is one of the city's own pools that holds nothing yet: its row invites the first position. */
export const proInvites = (row: ProPoolRow, input: Pick<ProListInput, 'adds' | 'deepUsd'>): boolean => input.adds(row) && (row.tvlUsd ?? 0) < input.deepUsd;
