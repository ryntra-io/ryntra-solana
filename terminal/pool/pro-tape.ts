import type { ProPoolRow } from '../../lib/pro-pools/model.ts';
import type { ProDaysAnswer, ProFill, ProPoolStats, TapePair } from '../../lib/pro-pools/tape.ts';

/**
 * A DLMM Pro pool's day, trades and filled limit orders as the screens say them — from the engine's open reads of the
 * program's own events (`/api/pro/pools/<address>/{stats,trades,fills}`, `lib/pro-pools/tape.ts`). Meteora gives none
 * of this for DLMM Pro.
 *
 * - A day the read did not cover whole is still a true floor: what traded in the part read happened inside the day. A
 *   table says such a figure with «≥»; a pool's head names the hours behind its «i».
 * - A read that did not answer is no figure at all — never a zero.
 *
 * Pure: the screens and the tests read it alike.
 */

export type ProDay = Readonly<{
  /** What traded, dollars at the price now; null — not priced. */
  volumeUsd: number | null;
  /** What the swaps paid the pool's liquidity — the depositors' part. */
  lpFeesUsd: number | null;
  /** Every part of the swaps' fees. */
  feesUsd: number | null;
  trades: number;
  wallets: number;
  /** Limit orders collected with a part filled, and the bonus their makers took. */
  filled: number;
  bonusPaidUsd: number | null;
  /** Whether the whole day (or the pool's whole life) is counted; false — a floor over `hours`. */
  whole: boolean;
  /** The hours counted, whole; null — nothing was read. */
  hours: number | null;
}>;

/** The day of a pool from its stats answer. */
export function dayOf(stats: ProPoolStats): ProDay {
  const from = stats.from ? Date.parse(stats.from) : NaN;
  const to = Date.parse(stats.to);
  const hours = Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.floor((to - from) / 3_600_000)) : null;
  return {
    volumeUsd: stats.volume.usd,
    lpFeesUsd: stats.fees.lp.usd,
    feesUsd: stats.fees.total.usd,
    trades: stats.trades.count,
    wallets: stats.trades.wallets,
    filled: stats.orders.filled + stats.orders.partial,
    bonusPaidUsd: stats.orders.bonusPaid.usd,
    whole: stats.whole,
    hours: stats.whole ? stats.hours : hours,
  };
}

/**
 * The days of the table from the answer of every pool's day at once: a counted pool by its figures; a pool still
 * counting keeps the day the page had for it, else has none (an empty cell, never a zero); a pool the engine could
 * not count has none and is not waited for — `counting` says only whether to ask again soon: some pool still counting.
 * A day read only in part is a floor («≥») the engine deepens at its usual pace; it is not asked for more often.
 */
export function daysOf(answer: ProDaysAnswer, was: ReadonlyMap<string, ProDay> = new Map()): Readonly<{ days: ReadonlyMap<string, ProDay>; counting: boolean }> {
  const days = new Map<string, ProDay>();
  let counting = false;
  for (const entry of answer.days) {
    if (entry.state === 'ready') days.set(entry.pool, dayOf(entry.stats));
    else if (entry.state === 'counting') {
      counting = true;
      const kept = was.get(entry.pool);
      if (kept) days.set(entry.pool, kept);
    }
  }
  return { days, counting };
}

/** The pair's two sides by the pool's own names, for the amounts of a fill (paid in X or Y). */
export function sidesOf(pair: TapePair): Readonly<{ x: TapePair['coin']; y: TapePair['coin'] }> {
  return pair.coin.side === 'x' ? { x: pair.coin, y: pair.quote } : { x: pair.quote, y: pair.coin };
}

/** Base units in whole coins. */
export const wholeOf = (raw: string, decimals: number): number => (/^\d+$/.test(raw) ? Number(BigInt(raw)) / 10 ** decimals : 0);

/** A filled order's proceeds and bonus in whole coins with the coin's ticker; null where the side is not known. */
export function fillAmounts(fill: ProFill, pair: TapePair): Readonly<{ got: Readonly<{ amount: number; symbol: string }> | null; bonus: readonly Readonly<{ amount: number; symbol: string }>[] }> {
  const sides = sidesOf(pair);
  const name = (side: 'x' | 'y') => sides[side].symbol ?? '';
  const got = fill.proceedsRaw !== null && fill.proceedsToken !== null ? { amount: wholeOf(fill.proceedsRaw, sides[fill.proceedsToken].decimals), symbol: name(fill.proceedsToken) } : null;
  const bonus = (['x', 'y'] as const).flatMap((side) => {
    const raw = side === 'x' ? fill.bonusXRaw : fill.bonusYRaw;
    const amount = wholeOf(raw, sides[side].decimals);
    return amount > 0 ? [{ amount, symbol: name(side) }] : [];
  });
  return { got, bonus };
}

/** A wallet's own page. */
export const walletHref = (address: string): string => `/wallet/${address}`;

/** What the DLMM Pro table may be ordered by beside its own order: the depth, the day's volume, the day's fees. */
export type ProSortKey = 'tvl' | 'volume' | 'fees';
export type ProSort = Readonly<{ key: ProSortKey; dir: 'desc' | 'asc' }> | null;

const proSortValue = (row: ProPoolRow, key: ProSortKey, days: ReadonlyMap<string, ProDay>): number | null => {
  if (key === 'tvl') return row.tvlUsd;
  const day = days.get(row.address);
  return day ? (key === 'volume' ? day.volumeUsd : day.lpFeesUsd) : null;
};

/** The rows in the order picked; a pool whose figure was not read goes last either way, in the list's own order. */
export function sortProRows(rows: readonly ProPoolRow[], sort: ProSort, days: ReadonlyMap<string, ProDay>): readonly ProPoolRow[] {
  if (!sort) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, at) => ({ row, at, value: proSortValue(row, sort.key, days) }))
    .sort((a, b) => (a.value === null || b.value === null ? (a.value === b.value ? a.at - b.at : a.value === null ? 1 : -1) : a.value !== b.value ? sign * (a.value - b.value) : a.at - b.at))
    .map((entry) => entry.row);
}
