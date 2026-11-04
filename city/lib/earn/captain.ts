import type { PositionView } from '../../../lib/liquidity/catalog/positions.ts';
import { ENTRY_TOLERANCE } from '../../../lib/liquidity/catalog/track.ts';
import { SOL_MINT } from './lst.ts';
import { isPierStyle, PIER_STYLES, STYLE_HALF, type PierStyle } from './pier.ts';

/**
 * «Like the Captain» (CITY-99, `docs/research/ryntra-earn-2026-10-29/SPEC.md` E8): strategies with a record people can
 * copy. A **strategy** is one of the city's own pier recipes — a SOL pier (a Meteora DLMM pool) and a style (its bins on
 * each side of the price, spread evenly); the recipe is an internal format and never a screen of its own. A **copy** is
 * a position opened through the city with that recipe; the chain says it exists, whose it is, in which pool and how wide.
 *
 * Its **record** is SOL-2b's own arithmetic (`lib/liquidity/catalog/track.ts`) on every live copy, once a day: the
 * fees (unclaimed, plus what was seen leaving) and the price's move, against keeping the same coins — «fees minus IL».
 * A strategy reaches a card only with a proven record: at least {@link CAPTAIN_MIN_DAYS} days of it and at least
 * {@link CAPTAIN_MIN_COPIES} copies from different wallets, each of at least {@link COPY_MIN_LAMPORTS}. Its deepest
 * fall is always beside its result. The past, never a promise: nothing here projects a figure forward.
 *
 * Pure: the server, the routes, the window and the tests import it alike.
 */

/** A strategy needs this many days of record before a card shows it. */
export const CAPTAIN_MIN_DAYS = 30;
/** …and copies from at least this many wallets. */
export const CAPTAIN_MIN_COPIES = 5;
/** A copy counts from this much worth in SOL at its first read: dust cannot make a record. */
export const COPY_MIN_LAMPORTS = 100_000_000n;
/** A record not measured for this long is not current, and its card is taken down until it is. */
export const CAPTAIN_STALE_MS = 3 * 86_400_000;
/** A copy the chain has not confirmed within this long is dropped: it never opened, or not as the recipe. */
export const COPY_PENDING_MS = 86_400_000;
/** A position worth more than holding its entry by more than this share was added to: the entry no longer holds. */
export const COPY_GROWTH_TOLERANCE = 0.02;
/** The most daily points a card's line carries. */
export const SERIES_MAX = 90;

export type Recipe = Readonly<{ pool: string; style: PierStyle }>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isAddress = (value: unknown): value is string => typeof value === 'string' && BASE58.test(value);

export function recipeId(recipe: Recipe): string {
  return `${recipe.pool}:${recipe.style}`;
}

export function readRecipeId(id: unknown): Recipe | null {
  if (typeof id !== 'string') return null;
  const [pool, style, ...rest] = id.split(':');
  return rest.length === 0 && isAddress(pool) && isPierStyle(style) ? { pool, style } : null;
}

/** The style a DLMM position's bins make, inclusive; null for any other width. */
export function styleOfBins(lower: number, upper: number): PierStyle | null {
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || upper < lower) return null;
  const width = upper - lower + 1;
  return PIER_STYLES.find((style) => 2 * STYLE_HALF[style] + 1 === width) ?? null;
}

/* ------------------------------------------------------------------ copies */

/** What a copy held at its first confirmed read: each coin in its own unit, and its worth then. */
export type CopyEntry = Readonly<{ x: number; y: number; usd: number; lamports: string; at: number }>;

export type CopyResult = Readonly<{ holdUsd: number; netUsd: number; feesUsd: number; at: number }>;

export type CopyRecord = Readonly<{
  position: string;
  owner: string;
  pool: string;
  style: PierStyle;
  /** When the city told the ledger the position landed. */
  addedAt: number;
  /** Null until the chain confirms the position as the recipe. */
  entry: CopyEntry | null;
  /** Fees seen leaving the position since (a claim), dollars at the prices of the pass that saw them go. */
  claimedUsd: number;
  /** The unclaimed fees at the last pass, each coin's own unit: a fall between passes is a claim. */
  seenFees: Readonly<{ x: number; y: number }> | null;
  /** The position is gone, or changed where the recipe no longer describes it: its last result stays, it no longer counts live. */
  closedAt: number | null;
  last: CopyResult | null;
}>;

/** A copy as the city reports it once its add landed: nothing about it is believed until the chain says so. */
export function newCopy(input: Readonly<{ position: string; owner: string; pool: string; style: PierStyle }>, now: number): CopyRecord {
  return { ...input, addedAt: now, entry: null, claimedUsd: 0, seenFees: null, closedAt: null, last: null };
}

/** A position as the chain read it, with the bins it spans (DLMM) — enough to hold a copy to its recipe. */
export type SeenPosition = Pick<PositionView, 'address' | 'pool' | 'x' | 'y' | 'valueUsd' | 'rangeState'> &
  Readonly<{ owner: string; bins: Readonly<{ lower: number; upper: number }> | null }>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** SOL's dollar price on a position's own read: the side that is SOL. */
export function solUsdOf(seen: Pick<SeenPosition, 'x' | 'y'>): number | null {
  const side = seen.x.mint === SOL_MINT ? seen.x : seen.y.mint === SOL_MINT ? seen.y : null;
  return side && finite(side.priceUsd) && side.priceUsd > 0 ? side.priceUsd : null;
}

export type CopyPass =
  | Readonly<{ kind: 'pending'; copy: CopyRecord }>
  | Readonly<{ kind: 'drop'; reason: 'not-seen' | 'not-recipe' | 'unpriced' }>
  | Readonly<{ kind: 'live'; copy: CopyRecord }>
  | Readonly<{ kind: 'closed'; copy: CopyRecord }>;

/**
 * One pass over one copy with what the chain shows now (`seen` — null when the wallet holds no such position; `read`
 * false when the chain did not answer for the wallet, which changes nothing).
 *
 * - Unconfirmed: the position must be the wallet's own, in the recipe's pool, exactly the recipe's width and priced — then
 *   its amounts now are its entry. Not seen within {@link COPY_PENDING_MS}, or seen as something else: dropped.
 * - Confirmed: fees seen falling since the last pass were claimed and are kept; a position gone, narrowed, widened, or
 *   holding less of both coins (a withdrawal) or more worth than its entry could (a deposit) is closed — the record
 *   keeps what it last measured and stops counting it live.
 */
export function passCopy(copy: CopyRecord, seen: SeenPosition | null, read: boolean, now: number): CopyPass {
  if (copy.closedAt !== null) return { kind: 'closed', copy };
  if (!read) return copy.entry ? { kind: 'live', copy } : { kind: 'pending', copy };
  const recipe = seen && seen.owner === copy.owner && seen.pool === copy.pool && seen.bins && styleOfBins(seen.bins.lower, seen.bins.upper) === copy.style;

  if (!copy.entry) {
    if (!seen) return now - copy.addedAt > COPY_PENDING_MS ? { kind: 'drop', reason: 'not-seen' } : { kind: 'pending', copy };
    if (!recipe) return { kind: 'drop', reason: 'not-recipe' };
    const sol = solUsdOf(seen);
    if (seen.valueUsd === null || !(seen.valueUsd > 0) || sol === null) return now - copy.addedAt > COPY_PENDING_MS ? { kind: 'drop', reason: 'unpriced' } : { kind: 'pending', copy };
    const lamports = BigInt(Math.round((seen.valueUsd / sol) * 1e9)).toString();
    const entry: CopyEntry = { x: seen.x.amount, y: seen.y.amount, usd: seen.valueUsd, lamports, at: now };
    const confirmed: CopyRecord = { ...copy, entry, seenFees: { x: seen.x.unclaimed, y: seen.y.unclaimed } };
    return { kind: 'live', copy: { ...confirmed, last: resultOf(confirmed, seen, now) } };
  }

  const close = () => ({ kind: 'closed' as const, copy: { ...copy, closedAt: now } });
  if (!seen || !recipe) return close();
  const entry = copy.entry;
  // SOL-2b's own test: a price move trades one coin for the other, so both short is a withdrawal.
  const short = (held: number, put: number) => put > 0 && held < put * (1 - ENTRY_TOLERANCE);
  if (short(seen.x.amount, entry.x) && short(seen.y.amount, entry.y)) return close();
  // Fees that fell since the last pass left as a claim: counted at today's prices, never more than was seen.
  let claimed = copy.claimedUsd;
  const before = copy.seenFees;
  if (before) {
    const gone = (side: 'x' | 'y') => Math.max(0, before[side] - seen[side].unclaimed);
    const xPrice = seen.x.priceUsd ?? 0;
    const yPrice = seen.y.priceUsd ?? 0;
    claimed += gone('x') * xPrice + gone('y') * yPrice;
  }
  const next: CopyRecord = { ...copy, claimedUsd: claimed, seenFees: { x: seen.x.unclaimed, y: seen.y.unclaimed } };
  const result = resultOf(next, seen, now);
  if (result && result.holdUsd > 0 && result.netUsd - result.feesUsd > result.holdUsd * COPY_GROWTH_TOLERANCE) return close();
  return { kind: 'live', copy: { ...next, last: result ?? copy.last } };
}

/**
 * SOL-2b's sum for a copy: its entry's coins kept, at today's prices (hold); the position now plus its fees — unclaimed
 * and claimed — against that (net). Null without prices.
 */
export function resultOf(copy: CopyRecord, seen: SeenPosition, now: number): CopyResult | null {
  const entry = copy.entry;
  if (!entry || seen.valueUsd === null || !finite(seen.x.priceUsd) || !finite(seen.y.priceUsd)) return null;
  const holdUsd = entry.x * seen.x.priceUsd + entry.y * seen.y.priceUsd;
  if (!(holdUsd > 0)) return null;
  const unclaimed = seen.x.unclaimed * seen.x.priceUsd + seen.y.unclaimed * seen.y.priceUsd;
  const feesUsd = unclaimed + copy.claimedUsd;
  return { holdUsd, netUsd: seen.valueUsd - holdUsd + feesUsd, feesUsd, at: now };
}

/** Whether a confirmed copy is big enough to count toward a record. */
export function counts(copy: CopyRecord): boolean {
  return copy.entry !== null && /^\d+$/.test(copy.entry.lamports) && BigInt(copy.entry.lamports) >= COPY_MIN_LAMPORTS;
}

/* ------------------------------------------------------------------ the record */

/** One day of a strategy's record: its live copies summed. */
export type StrategyPoint = Readonly<{ strategy: string; day: string; copies: number; holdUsd: number; netUsd: number; feesUsd: number; at: number }>;

export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's point of every strategy with a live copy that counts and was measured in this pass. */
export function dayPoints(copies: readonly CopyRecord[], now: number): StrategyPoint[] {
  const day = dayOf(now);
  const sums = new Map<string, { copies: number; holdUsd: number; netUsd: number; feesUsd: number }>();
  for (const copy of copies) {
    if (copy.closedAt !== null || !counts(copy) || !copy.last || dayOf(copy.last.at) !== day) continue;
    const id = recipeId(copy);
    const sum = sums.get(id) ?? { copies: 0, holdUsd: 0, netUsd: 0, feesUsd: 0 };
    sum.copies += 1;
    sum.holdUsd += copy.last.holdUsd;
    sum.netUsd += copy.last.netUsd;
    sum.feesUsd += copy.last.feesUsd;
    sums.set(id, sum);
  }
  return [...sums].map(([strategy, sum]) => ({ strategy, day, ...sum, at: now }));
}

/** The record as a line: each day, the live copies against holding the same coins, per cent. */
export function resultLine(points: readonly StrategyPoint[]): number[] {
  return [...points]
    .filter((point) => point.holdUsd > 0)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((point) => (point.netUsd / point.holdUsd) * 100);
}

/**
 * The deepest fall of the line from its highest point before it, percentage points — a record starts level with
 * holding, so a line that only went down falls from zero. Never negative.
 */
export function drawdownPct(line: readonly number[]): number {
  let peak = 0;
  let deepest = 0;
  for (const value of line) {
    if (!Number.isFinite(value)) continue;
    peak = Math.max(peak, value);
    deepest = Math.max(deepest, peak - value);
  }
  return deepest;
}

export type ProvenStrategy = Readonly<{
  id: string;
  pool: string;
  style: PierStyle;
  /** Days of record, from its first point to now. */
  days: number;
  /** Wallets whose copy counted, live or since closed. */
  copies: number;
  /** Copies counted live in the latest point. */
  live: number;
  /** The latest point: the live copies against holding — fees and the price's move — and the two apart, per cent. */
  resultPct: number;
  feesPct: number;
  pricePct: number;
  /** The deepest fall of the line, percentage points; always shown. */
  drawdownPct: number;
  /** The line, one value a day, the latest last. */
  series: readonly number[];
  since: number;
  at: number;
}>;

const DAY_MS = 86_400_000;

/**
 * The strategies with a proven record, best first: a line covering at least {@link CAPTAIN_MIN_DAYS} days, measured in
 * the last {@link CAPTAIN_STALE_MS}, and copies from at least {@link CAPTAIN_MIN_COPIES} wallets. Ranked by the result
 * less its deepest fall — a record that got there smoothly before one that swung.
 */
export function provenStrategies(copies: readonly CopyRecord[], points: readonly StrategyPoint[], now: number): ProvenStrategy[] {
  const byStrategy = new Map<string, StrategyPoint[]>();
  for (const point of points) {
    if (!readRecipeId(point.strategy)) continue;
    const list = byStrategy.get(point.strategy) ?? [];
    list.push(point);
    byStrategy.set(point.strategy, list);
  }
  const wallets = new Map<string, Set<string>>();
  for (const copy of copies) {
    if (!counts(copy)) continue;
    const id = recipeId(copy);
    const set = wallets.get(id) ?? new Set<string>();
    set.add(copy.owner);
    wallets.set(id, set);
  }
  const out: ProvenStrategy[] = [];
  for (const [id, list] of byStrategy) {
    const recipe = readRecipeId(id)!;
    const sorted = [...list].filter((point) => point.holdUsd > 0).sort((a, b) => (a.day < b.day ? -1 : 1));
    const first = sorted[0];
    const latest = sorted.at(-1);
    if (!first || !latest || sorted.length < 2) continue;
    const since = Date.parse(`${first.day}T00:00:00Z`);
    const days = Math.floor((now - since) / DAY_MS);
    const copiesCounted = wallets.get(id)?.size ?? 0;
    if (days < CAPTAIN_MIN_DAYS || now - latest.at > CAPTAIN_STALE_MS || copiesCounted < CAPTAIN_MIN_COPIES) continue;
    const line = resultLine(sorted);
    out.push({
      id,
      pool: recipe.pool,
      style: recipe.style,
      days,
      copies: copiesCounted,
      live: latest.copies,
      resultPct: line.at(-1)!,
      feesPct: (latest.feesUsd / latest.holdUsd) * 100,
      pricePct: ((latest.netUsd - latest.feesUsd) / latest.holdUsd) * 100,
      drawdownPct: drawdownPct(line),
      series: line.slice(-SERIES_MAX),
      since,
      at: latest.at,
    });
  }
  return out.sort((a, b) => b.resultPct - b.drawdownPct - (a.resultPct - a.drawdownPct) || b.copies - a.copies || (a.id < b.id ? -1 : 1));
}

/* ------------------------------------------------------------------ the answer */

export type CaptainAnswer = Readonly<{
  strategies: readonly ProvenStrategy[];
  /** The ledger is kept where every server sees it: copies are being counted. */
  counting: boolean;
  at: number;
}>;

/** The route's answer, read field by field; a strategy that does not read is left out, never repaired. */
export function readCaptainAnswer(body: unknown): CaptainAnswer | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (!Array.isArray(value.strategies) || typeof value.counting !== 'boolean' || !finite(value.at)) return null;
  const strategies: ProvenStrategy[] = [];
  for (const raw of value.strategies) {
    const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const recipe = s ? readRecipeId(s.id) : null;
    if (!s || !recipe || s.pool !== recipe.pool || s.style !== recipe.style) continue;
    const numbers = ['days', 'copies', 'live', 'resultPct', 'feesPct', 'pricePct', 'drawdownPct', 'since', 'at'] as const;
    if (!numbers.every((key) => finite(s[key]))) continue;
    if (!Array.isArray(s.series) || !s.series.every(finite)) continue;
    // The gate holds on the page too: a card never shows a record short of it, whatever answered.
    if ((s.days as number) < CAPTAIN_MIN_DAYS || (s.copies as number) < CAPTAIN_MIN_COPIES || (s.drawdownPct as number) < 0) continue;
    strategies.push({
      id: recipeId(recipe),
      pool: recipe.pool,
      style: recipe.style,
      days: s.days as number,
      copies: s.copies as number,
      live: s.live as number,
      resultPct: s.resultPct as number,
      feesPct: s.feesPct as number,
      pricePct: s.pricePct as number,
      drawdownPct: s.drawdownPct as number,
      series: (s.series as number[]).slice(-SERIES_MAX),
      since: s.since as number,
      at: s.at as number,
    });
  }
  return { strategies, counting: value.counting, at: value.at };
}

/** A per-cent figure for a card: signed, two places under ten, one above. */
export function pctText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const body = abs.toFixed(abs >= 10 ? 1 : 2);
  if (Number(body) === 0) return '0%';
  return `${value > 0 ? '+' : '−'}${body}%`;
}

/** A line in a box, as an SVG path, with a zero line where holding stands. */
export function sparkOf(series: readonly number[], width: number, height: number): Readonly<{ line: string; zero: number; end: Readonly<{ x: number; y: number }> }> | null {
  const values = series.filter(Number.isFinite);
  if (values.length < 2) return null;
  let top = Math.max(0, ...values);
  let bottom = Math.min(0, ...values);
  const pad = (top - bottom) * 0.12 || 0.5;
  top += pad;
  bottom -= pad;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => ((top - v) / (top - bottom)) * height;
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return { line, zero: y(0), end: { x: x(values.length - 1), y: y(values.at(-1)!) } };
}
