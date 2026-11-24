import type { EarnBinsAnswer } from '../../lib/earn-pools/bins.ts';
import { stepFigure } from '../ui/figures.ts';
import { byDepth, quietReason, type ProPoolRow } from '../../lib/pro-pools/model.ts';
import { lookalikeOf } from '../../lib/world/text-safety/lookalike.ts';
import { rudeName } from '../launch/rude.ts';

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

/** A position's range as the pool states it: Y per X, both bounds. */
export type MineRange = Readonly<{ lower: number; upper: number }>;

/** Where a range stands over «Liquidity by price»: from and to, per cent of the plot's width, cheapest first. */
export type MineBand = Readonly<{ fromPct: number; toPct: number }>;

/**
 * The person's own range over the pool's liquidity by price: the columns whose price lies inside it, in the
 * coin's own terms as the columns run (`side` — the coin's side of the pool; for the coin as Y the range turns over).
 * A half step of slack on each bound keeps the edge columns a position holds. Null where the range is not a range or
 * holds none of the columns shown.
 */
export function mineBand(view: DistView, range: MineRange, side: 'x' | 'y'): MineBand | null {
  if (!(range.lower > 0) || !(range.upper >= range.lower) || !view.columns.length) return null;
  const low = side === 'x' ? range.lower : 1 / range.upper;
  const high = side === 'x' ? range.upper : 1 / range.lower;
  const ratio = view.columns.length > 1 ? Math.abs(view.columns[1]!.price / view.columns[0]!.price) : 1;
  const slack = Number.isFinite(ratio) && ratio > 1 ? Math.sqrt(ratio) : 1.0001;
  const inside = view.columns.flatMap((column, at) => (column.price >= low / slack && column.price <= high * slack ? [at] : []));
  if (!inside.length) return null;
  const count = view.columns.length;
  return { fromPct: (inside[0]! / count) * 100, toPct: ((inside.at(-1)! + 1) / count) * 100 };
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

/**
 * `there` — that pool's bonus, `here` — this pool's, basis points.
 */
export const elsewhereBetter = (there: number, here: number): boolean => Number.isFinite(there) && Number.isFinite(here) && there > here;

/**
 * A whole thousand stays as written («1,240»).
 */
export function evenPlaces(low: string, high: string): Readonly<{ low: string; high: string }> {
  const places = (text: string) => (/^\d+\.\d+$/.test(text) ? text.length - text.indexOf('.') - 1 : /^\d+$/.test(text) ? 0 : -1);
  const a = places(low);
  const b = places(high);
  if (a < 0 || b < 0 || a === b) return { low, high };
  const pad = (text: string, have: number, want: number) => (have >= want ? text : `${text}${have === 0 ? '.' : ''}${'0'.repeat(want - have)}`);
  const want = Math.max(a, b);
  return { low: pad(low, a, want), high: pad(high, b, want) };
}

export const unbroken = (part: string | null): string | null => (part === null ? null : part.replace(/ /g, '\u00a0'));

/* ── the list of DLMM Pro's pools ─────────────────────────────────────────────────────────────────────── */

/** Both coins of the pool verified by the catalogue. */
export const proVerified = (row: Pick<ProPoolRow, 'x' | 'y'>): boolean => row.x.verified === true && row.y.verified === true;

/** A ticker that passes for a known coin's it is not (`lib/world/text-safety/lookalike.ts`). */
const passesFor = (symbol: string, mint: string): boolean => lookalikeOf(symbol, mint) !== null;

/**
 * Why a pool stays out of DLMM Pro's list, «Active» and «All» alike: no name, a test, a crude name (the lists' own words
 * and the Launch showcase's, `terminal/launch/rude.ts`), a look-alike ticker; null — nothing. The pool keeps its own
 * page at its address; it is just not offered («TEST · SOL», «Cx9c…», «BUTTHOLE · SOL» stood under «All»).
 */
export const proQuiet = (row: Pick<ProPoolRow, 'x' | 'y'>) =>
  // A pool of two verified coins keeps its place whatever its name: the crude words are for names nobody vouched for
  // (FARTCOIN, MOG are real markets — `terminal/launch/rude.ts` leaves the market's own lists as they are).
  quietReason(row, passesFor) ?? (!proVerified(row) && rudeName(row.x.symbol, row.x.name, row.y.symbol, row.y.name) ? 'crude' : null);

export type ProLeadInput = Readonly<{
  /** From this deep, dollars, a pool of verified coins can lead: a person can use it today. */
  leadUsd: number;
  /** From this deep, dollars, a pool counts as one that holds liquidity. */
  deepUsd: number;
}>;

/**
 * The pool DLMM Pro leads with — the card above the tabs of «Earn» and the first row of `/pro` alike: the best
 * limit bonus among the pools of verified coins with real liquidity (MET/SOL +0.6 %, not the deepest pool's +0.06 %), a
 * tie to the deeper one; where none stands, the deepest pool of verified coins, else the deepest. Never a name the list
 * keeps out of sight.
 */
export function proLead(rows: readonly ProPoolRow[], input: ProLeadInput): ProPoolRow | null {
  const shown = rows.filter((row) => proQuiet(row) === null);
  const usable = shown.filter((row) => proVerified(row) && (row.tvlUsd ?? 0) >= input.leadUsd);
  const best = [...usable].sort((a, b) => b.bonusBps - a.bonusBps || byDepth(a, b))[0];
  if (best) return best;
  const deep = shown.filter((row) => (row.tvlUsd ?? 0) >= input.deepUsd).sort(byDepth);
  return deep.find(proVerified) ?? deep[0] ?? null;
}

export type ProListInput = ProLeadInput &
  Readonly<{
    which: 'deep' | 'every';
    /** The pools the city adds to from here: their ticket is the add, with «My shape». */
    adds: (row: ProPoolRow) => boolean;
  }>;

/**
 * DLMM Pro's list as `/pro` lays it (the QA of 19.11 day: two JitoSOL · SOL with $0 and «Be the first» stood
 * second and third, over MET/SOL): first the pool DLMM Pro leads with (`proLead` — the card's own), then the other pools
 * of verified coins with liquidity, deepest first, then the rest with liquidity; only at the end of «Active» the city's
 * own pools that hold nothing yet, each a quiet «Be the first». «All» goes on with the pools that hold nothing. Neither
 * shows a name a person should not meet (`proQuiet`).
 */
export function proListRows(rows: readonly ProPoolRow[], input: ProListInput): ProPoolRow[] {
  const deep = (row: ProPoolRow) => (row.tvlUsd ?? 0) >= input.deepUsd;
  const listed = rows.filter((row) => proQuiet(row) === null && (input.which === 'every' || deep(row) || input.adds(row)));
  const lead = proLead(listed, input);
  const tier = (row: ProPoolRow) => (row === lead && deep(row) ? 0 : deep(row) ? (proVerified(row) ? 1 : 2) : input.adds(row) ? 3 : 4);
  return [...listed].sort((a, b) => tier(a) - tier(b) || byDepth(a, b));
}

/** Whether a row is one of the city's own pools that holds nothing yet: its row invites the first position. */
export const proInvites = (row: ProPoolRow, input: Pick<ProListInput, 'adds' | 'deepUsd'>): boolean => input.adds(row) && (row.tvlUsd ?? 0) < input.deepUsd;
