import type { SpotMarketListRow } from "@/lib/spot/markets";

/**
 * The pulse of a list — four figures the list itself carries, so nothing on
 * the tiles is a number the rows do not have (canon §14.1: no decorative
 * figure). The most traded row by the day's volume, the biggest move by the
 * absolute day's change, the most liquid row by the pool, and the activity:
 * the sum of the day's volume over the rows shown, with how many rose and
 * how many fell. A row without the figure is not a candidate for that tile,
 * and the biggest move is judged among verified rows only — an unverified
 * look-alike printing +18,000% on a $70K pool is noise, not the day's move.
 */
export type Pulse = Readonly<{
  mostTraded: SpotMarketListRow | null;
  biggestMove: SpotMarketListRow | null;
  mostLiquid: SpotMarketListRow | null;
  /** The day's volume summed over the rows shown, USD. */
  volumeUsd: number;
  /** How many rows are shown. */
  count: number;
  up: number;
  down: number;
}>;

function best(rows: readonly SpotMarketListRow[], value: (row: SpotMarketListRow) => number | null): SpotMarketListRow | null {
  let found: SpotMarketListRow | null = null;
  let top = -Infinity;
  for (const row of rows) {
    const figure = value(row);
    if (figure === null || !Number.isFinite(figure)) continue;
    if (figure > top) {
      top = figure;
      found = row;
    }
  }
  return found;
}

export function pulseOf(rows: readonly SpotMarketListRow[]): Pulse {
  let volumeUsd = 0;
  let up = 0;
  let down = 0;
  for (const row of rows) {
    if (row.volume24hUsd !== null && Number.isFinite(row.volume24hUsd)) volumeUsd += row.volume24hUsd;
    if (row.change24hPct !== null && Number.isFinite(row.change24hPct)) {
      if (row.change24hPct > 0) up += 1;
      else if (row.change24hPct < 0) down += 1;
    }
  }
  return {
    mostTraded: best(rows, (row) => row.volume24hUsd),
    biggestMove: best(rows, (row) => (row.change24hPct === null || !row.verified ? null : Math.abs(row.change24hPct))),
    mostLiquid: best(rows, (row) => row.liquidityUsd),
    volumeUsd,
    count: rows.length,
    up,
    down,
  };
}
