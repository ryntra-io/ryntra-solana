import type { InstrumentClass, RadarRow } from "./radar.ts";
import { isTradable } from "./radar.ts";

/**
 * What Radar's tiles draw.
 *
 * Pure functions over rows the page already has, in their own module so
 * `node --test` can reach them — a figure rendered inside a chart is exactly
 * the kind of number that goes wrong quietly, because nobody reads a
 * forty-pixel sparkline and checks the arithmetic.
 *
 * Every one of them counts only what it can see. A row the venue did not price
 * is absent from the movement histogram rather than counted as zero change,
 * and the surface states the denominator it actually used.
 */

/* ------------------------------------------------------------------- class */

export type ClassMix = Readonly<{ instrumentClass: InstrumentClass; count: number }>[];

export function classMix(rows: readonly RadarRow[]): ClassMix {
  const order: InstrumentClass[] = ["STOCK_TOKEN", "GENERIC_ERC20", "COMMUNITY_TOKEN"];
  const counts = new Map<InstrumentClass, number>(order.map((c) => [c, 0]));
  for (const row of rows) counts.set(row.instrumentClass, (counts.get(row.instrumentClass) ?? 0) + 1);
  return order.map((instrumentClass) => Object.freeze({ instrumentClass, count: counts.get(instrumentClass) ?? 0 }));
}

/* ---------------------------------------------------------------- movement */

export type Movement = Readonly<{
  /** Bucket counts, most negative first. The middle bucket is "flat". */
  buckets: readonly number[];
  /** Bucket edges in percent, for the legend. */
  edges: readonly number[];
  up: number;
  down: number;
  flat: number;
  /** Rows the venue actually reported a 24-hour change for. */
  judged: number;
  total: number;
}>;

const EDGES = [-10, -5, -2, -0.5, 0.5, 2, 5, 10] as const;

/**
 * The distribution of 24-hour change across the universe.
 *
 * A histogram rather than an average, because an average over 231 instruments
 * spanning equities, stablecoins and community tokens is a number with no
 * referent. The shape says *what kind of day it is* in one glance, which an
 * average never does.
 */
export function movement(rows: readonly RadarRow[]): Movement {
  const buckets = new Array(EDGES.length + 1).fill(0);
  let up = 0;
  let down = 0;
  let flat = 0;
  let judged = 0;

  for (const row of rows) {
    if (!row.changePercent24h.known) continue;
    judged += 1;
    const v = row.changePercent24h.value;
    if (v > 0.5) up += 1;
    else if (v < -0.5) down += 1;
    else flat += 1;
    let index = EDGES.findIndex((edge) => v < edge);
    if (index === -1) index = EDGES.length;
    buckets[index] += 1;
  }

  return Object.freeze({
    buckets: Object.freeze(buckets),
    edges: EDGES,
    up,
    down,
    flat,
    judged,
    total: rows.length,
  });
}

/* ---------------------------------------------------------------- listings */

export type Listings = Readonly<{
  /** One count per day, oldest first. */
  perDay: readonly number[];
  days: number;
  /** Rows carrying a listing timestamp at all. */
  stamped: number;
  total: number;
  withinWindow: number;
}>;

/**
 * How many tokens the venue listed per day, straight off `addedTimestamp`.
 *
 * A real series with no snapshot kept anywhere: the venue stamps the date, so
 * the shape of the last month exists in the response the page already fetched.
 * The twenty rows carrying no stamp are excluded and counted, never dated to
 * the epoch.
 */
export function listings(rows: readonly RadarRow[], now: number, days = 30): Listings {
  const perDay = new Array(days).fill(0);
  let stamped = 0;
  let withinWindow = 0;
  const dayMs = 86_400_000;

  for (const row of rows) {
    if (!row.listedAt.known) continue;
    stamped += 1;
    const age = Math.floor((now - row.listedAt.value) / dayMs);
    if (age < 0 || age >= days) continue;
    perDay[days - 1 - age] += 1;
    withinWindow += 1;
  }

  return Object.freeze({ perDay: Object.freeze(perDay), days, stamped, total: rows.length, withinWindow });
}

/* ---------------------------------------------------------------- coverage */

export type Coverage = Readonly<{ verified: number; priced: number; executable: number; total: number }>;

export function coverage(rows: readonly RadarRow[]): Coverage {
  let verified = 0;
  let priced = 0;
  let executable = 0;
  for (const row of rows) {
    if (row.venueVerified) verified += 1;
    if (row.price.known) priced += 1;
    if (isTradable(row.tradability)) executable += 1;
  }
  return Object.freeze({ verified, priced, executable, total: rows.length });
}

/* ------------------------------------------------------------------ volume */

/**
 * The traded universe as a density grid, one cell per instrument, ordered by
 * 24-hour volume.
 *
 * The magnitude is the **rank** rather than the raw figure, because volume
 * across this universe spans six orders of magnitude and a linear scale would
 * paint one bright cell and 230 black ones. A rank grid answers the question a
 * reader actually has — how concentrated is the activity — and the legend says
 * that is what it is.
 */
export function volumeRanks(rows: readonly RadarRow[], limit = 96): readonly number[] {
  const values = rows
    .filter((row) => row.volume24h.known)
    .map((row) => row.volume24h.known ? row.volume24h.value : 0)
    .sort((a, b) => b - a)
    .slice(0, limit);
  if (values.length === 0) return Object.freeze([]);
  const top = values.length - 1 || 1;
  return Object.freeze(values.map((_, index) => 1 - index / top));
}
