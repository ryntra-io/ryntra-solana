/**
 * Liquidity badges — Pool Contributor · Steward · Strategist: recognition for a pool position the chain proves, never money.
 *
 * | Badge | For |
 * |---|---|
 * | Pool Contributor | at least {@link MIN_POSITION_USD} in verified tokens in a live Meteora DLMM or DAMM v2 pool, read from Solana under the proven wallet |
 * | Steward | such a position in range on {@link STEWARD_DAYS} days Ryntra read it |
 * | Strategist | a DLMM position — bins its owner chose — in range on {@link STRATEGIST_DAYS} days Ryntra read it |
 *
 * ## What counts
 *
 * A position counts when the chain says this wallet may withdraw it and the
 * part it may withdraw now holds at least the minimum in tokens the venue
 * marks verified, at the venue's prices. A token anyone can mint and price
 * by its own pool is worth nothing here: a wallet could otherwise hold
 * «$1 000 000» of its own token in a pool nobody trades, always in range. A
 * locked part does not count either: a launch locks its pool's liquidity for
 * the creator and for Ryntra, and nobody chose to add that. A position
 * without a price is not counted that day — no data is never a guess.
 *
 * The pool must be live: not on the venue's blacklist, at least
 * {@link POOL_MIN_VERIFIED_USD} in verified tokens, and traded in the last
 * day — «in range» means something only where a price moves.
 *
 * DAMM v2 sets one range for the whole pool, so its positions, however
 * narrow the pool, count for Steward and not for Strategist: Strategist is
 * for a range a person chose.
 *
 * ## Days, and who saw them
 *
 * A day is a UTC day on which Ryntra read the wallet's positions and found a
 * counted one inside its range. Ryntra reads them when the wallet's owner
 * opens Rewards → Creator partners on Ryntra's own site, so a day nobody
 * looked is not a day in range — the badge
 * says what was seen, never more. Days need not follow one another. A badge,
 * once earned, keeps the moment it was earned: withdrawing later does not
 * take it back, as a launch that ended does not take back «Launched».
 *
 * ## Public only by choice
 *
 * Nothing here leaves the wallet's own page unless the wallet chose to show
 * its liquidity badges on the boards; the choice is its own, behind its own
 * proof, and can be taken back.
 *
 * Pure: the store and the chain read live beside it.
 */

import type { CatalogPool } from "../liquidity/catalog/model.ts";
import type { PositionView } from "../liquidity/catalog/positions.ts";

export const LIQUIDITY_BADGE_IDS = ["POOL_CONTRIBUTOR", "STEWARD", "STRATEGIST"] as const;
export type LiquidityBadgeId = (typeof LIQUIDITY_BADGE_IDS)[number];

/** The least a counted position holds in verified tokens that its owner may withdraw now, USD. */
export const MIN_POSITION_USD = 10;
/** The least a live pool holds in verified tokens, USD — the same number as the pools catalogue's TVL floor, counted on verified tokens only. */
export const POOL_MIN_VERIFIED_USD = 10_000;
/** Days in range, seen by Ryntra, for Steward. */
export const STEWARD_DAYS = 7;
/** Days a concentrated range was in range, seen by Ryntra, for Strategist. */
export const STRATEGIST_DAYS = 30;
/** The most days a record keeps of each kind: enough for the longest badge, never a growing history. */
export const DAYS_KEPT = STRATEGIST_DAYS;

/** One position as the chain read it today, reduced to what the badges ask. */
export type LiquiditySighting = Readonly<{
  pool: string;
  /** What it holds in verified tokens at the venue's prices; null — the pool's record or a price is missing. */
  valueUsd: number | null;
  /** 0–10 000: the part its owner cannot withdraw now. */
  lockedBps: number;
  inRange: boolean;
  /** Its owner chose its range: a DLMM position's bins. */
  concentrated: boolean;
  /** Not blacklisted, at least {@link POOL_MIN_VERIFIED_USD} in verified tokens, traded in the last day. */
  poolLive: boolean;
}>;

export type LiquidityRecord = Readonly<{
  version: number;
  network: "solana";
  wallet: string;
  /** Days (UTC, `YYYY-MM-DD`) a counted position was seen in range — at most {@link DAYS_KEPT}, the latest. */
  days: readonly string[];
  /** Days a counted concentrated position was seen in range. */
  rangedDays: readonly string[];
  earned: Readonly<Partial<Record<LiquidityBadgeId, string>>>;
  /** The wallet chose to show its liquidity badges on the boards. */
  public: boolean;
  publicAt: string | null;
}>;

/** The part of a position its owner may withdraw now, USD; null without a price. */
export function withdrawableUsd(position: LiquiditySighting): number | null {
  if (position.valueUsd === null || !Number.isFinite(position.valueUsd) || position.valueUsd < 0) return null;
  const locked = Math.min(10_000, Math.max(0, Math.trunc(position.lockedBps)));
  return (position.valueUsd * (10_000 - locked)) / 10_000;
}

const sideUsd = (amount: number | null, price: number | null, verified: boolean): number | null =>
  !verified ? 0 : amount === null || price === null || !Number.isFinite(amount) || !Number.isFinite(price) ? null : amount * price;

/** The pool is live: not blacklisted, enough in verified tokens, traded in the last day. */
export function poolLive(record: CatalogPool | null): boolean {
  if (!record || record.blacklisted) return false;
  const x = sideUsd(record.xAmount, record.x.priceUsd, record.x.verified) ?? 0;
  const y = sideUsd(record.yAmount, record.y.priceUsd, record.y.verified) ?? 0;
  return x + y >= POOL_MIN_VERIFIED_USD && (record.volume24hUsd ?? 0) > 0;
}

/** What a badge asks of one position: its value in verified tokens only, and whether its pool is live. */
export function sightingOf(view: PositionView, record: CatalogPool | null): LiquiditySighting {
  /* A record that does not name the position's own two tokens is no data about it — never a zero. */
  const matched = record !== null && record.x.mint === view.x.mint && record.y.mint === view.y.mint;
  const x = matched ? sideUsd(view.x.amount, view.x.priceUsd, record.x.verified) : null;
  const y = matched ? sideUsd(view.y.amount, view.y.priceUsd, record.y.verified) : null;
  return {
    pool: view.pool,
    valueUsd: x !== null && y !== null ? x + y : null,
    lockedBps: view.lockedBps,
    inRange: view.rangeState === "in_range",
    concentrated: view.kind === "dlmm",
    poolLive: poolLive(record),
  };
}

/** The positions a badge may count today. */
export function countedPositions(positions: readonly LiquiditySighting[]): readonly LiquiditySighting[] {
  return positions.filter((position) => {
    const usd = withdrawableUsd(position);
    return position.poolLive === true && usd !== null && usd >= MIN_POSITION_USD;
  });
}

/** The day of a moment, UTC. */
export function sightingDay(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error("A sighting needs a readable moment.");
  return new Date(ms).toISOString().slice(0, 10);
}

/** The days with `day` added: unique, in order, the latest {@link DAYS_KEPT}. */
function withDay(days: readonly string[], day: string): readonly string[] {
  if (days.includes(day)) return days;
  return [...days, day].sort().slice(-DAYS_KEPT);
}

export function emptyLiquidityRecord(wallet: string): LiquidityRecord {
  return { version: 0, network: "solana", wallet, days: [], rangedDays: [], earned: {}, public: false, publicAt: null };
}

/**
 * The record after one read of the chain: today's day added where a counted
 * position was in range, and each badge whose count it reached dated now.
 * Null when nothing changes — the caller writes nothing.
 */
export function observeLiquidity(record: LiquidityRecord, positions: readonly LiquiditySighting[], at: string): LiquidityRecord | null {
  const counted = countedPositions(positions);
  if (counted.length === 0) return null;
  const day = sightingDay(at);
  const days = counted.some((position) => position.inRange) ? withDay(record.days, day) : record.days;
  const rangedDays = counted.some((position) => position.inRange && position.concentrated) ? withDay(record.rangedDays, day) : record.rangedDays;
  const earned: Partial<Record<LiquidityBadgeId, string>> = { ...record.earned };
  earned.POOL_CONTRIBUTOR ??= at;
  if (days.length >= STEWARD_DAYS) earned.STEWARD ??= at;
  if (rangedDays.length >= STRATEGIST_DAYS) earned.STRATEGIST ??= at;
  const changed =
    days !== record.days || rangedDays !== record.rangedDays || LIQUIDITY_BADGE_IDS.some((id) => earned[id] !== record.earned[id]);
  if (!changed) return null;
  return { ...record, version: record.version + 1, days, rangedDays, earned };
}

/** One liquidity badge on the wallet's own page: held and since when, or how far along. */
export type LiquidityBadgeState = Readonly<{ id: LiquidityBadgeId; earned: boolean; at: string | null; have: number; need: number }>;

/** The track: the three badges, each with the days it counts. */
export function liquidityTrack(record: LiquidityRecord): readonly LiquidityBadgeState[] {
  const state = (id: LiquidityBadgeId, have: number, need: number): LiquidityBadgeState => {
    const at = record.earned[id] ?? null;
    return { id, earned: at !== null, at, have: at !== null ? need : Math.min(have, need), need };
  };
  return [
    state("POOL_CONTRIBUTOR", record.earned.POOL_CONTRIBUTOR ? 1 : 0, 1),
    state("STEWARD", record.days.length, STEWARD_DAYS),
    state("STRATEGIST", record.rangedDays.length, STRATEGIST_DAYS),
  ];
}

/** The highest liquidity badge the record holds; null — none. */
export function topLiquidityBadge(record: LiquidityRecord): LiquidityBadgeId | null {
  for (const id of [...LIQUIDITY_BADGE_IDS].reverse()) if (record.earned[id]) return id;
  return null;
}

/** What the boards may show: the highest badge of each wallet that chose to show it, and of no other. */
export function publicLiquidity(records: readonly LiquidityRecord[]): Readonly<Record<string, LiquidityBadgeId>> {
  const out: Record<string, LiquidityBadgeId> = {};
  for (const record of records) {
    if (record.public !== true || typeof record.wallet !== "string") continue;
    const top = topLiquidityBadge(record);
    if (top) out[record.wallet] = top;
  }
  return out;
}

/** The record with the wallet's choice about the boards. Null when it already holds. */
export function withLiquidityChoice(record: LiquidityRecord, shown: boolean, at: string): LiquidityRecord | null {
  if (record.public === shown) return null;
  return { ...record, version: record.version + 1, public: shown, publicAt: shown ? at : null };
}

/** What the wallet's own page reads: the track, how today's read went and the wallet's choice. */
export type LiquidityView = Readonly<{
  badges: readonly LiquidityBadgeState[];
  /** Today's read of the chain: null — Solana did not answer, and nothing was added. */
  read: Readonly<{
    /** One venue did not answer: its positions were not seen this time. */
    partial: boolean;
    /** Positions read, counted ones (at least the minimum, withdrawable) and those in range among them. */
    positions: number;
    counted: number;
    inRange: number;
    /** Positions whose price was not read: not counted this time. */
    unpriced: number;
    at: string;
  }> | null;
  public: boolean;
  minUsd: number;
}>;

export function liquidityView(
  record: LiquidityRecord,
  read: Readonly<{ partial: boolean; positions: readonly LiquiditySighting[]; unpriced: number; at: string }> | null,
): LiquidityView {
  const counted = read ? countedPositions(read.positions) : [];
  return {
    badges: liquidityTrack(record),
    read: read
      ? { partial: read.partial, positions: read.positions.length, counted: counted.length, inRange: counted.filter((position) => position.inRange).length, unpriced: read.unpriced, at: read.at }
      : null,
    public: record.public,
    minUsd: MIN_POSITION_USD,
  };
}
