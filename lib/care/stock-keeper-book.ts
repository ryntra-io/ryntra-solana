/**
 * The keeper's book: one row per stock position a person gave the keeper, beside the care's own rows in the
 * Guard store's `agentCare` collection, keyed `k:<network>:<owner>:<nft mint>`.
 * What the keeper read of the hours and did; public data only.
 *
 * And the two readings the pass needs that are pure: the range that holds a position's liquidity, as prices, and the
 * exchange's reference in the pool's own units.
 *
 * Pure: no I/O, no clock.
 */

import { hoursOf, type StockSession } from "../../city/lib/earn/stock-pier-hours.ts";
import { keeperModeOf, liveRangeOf, type KeeperMode, type LiveRange, type RangeLimits, type RawPair, type ShiftRecord } from "./range-limits.ts";
import type { DividendPlan } from "./stock-hours.ts";
import type { KeeperChoice, KeeperHours, KeeperView, KeeperWait } from "./stock-keeper-terms.ts";

export type KeeperNetwork = "devnet" | "mainnet";

export type KeeperEvent = Readonly<{
  at: number;
  kind: "narrow" | "wide" | "pull" | "claim" | "refused";
  signature: string | null;
  /** For a refusal: the bound or the chain's word, short. */
  reason?: string;
}>;

export type KeeperEntry = Readonly<{
  v: 1;
  kind: "stock-keeper";
  key: string;
  network: KeeperNetwork;
  owner: string;
  pool: string;
  nftMint: string;
  agent: string;
  choice: KeeperChoice;
  limits: RangeLimits;
  plan: DividendPlan;
  /** The spending approval the person signed on her own two accounts; null — a keeper that only takes out. */
  approval: RawPair | null;
  status: "signing" | "working" | "stopped";
  stoppedBy: "owner" | "gone" | null;
  /** Whether the chain has shown the approval; the pass confirms it, and lets go of a row the chain never shows. */
  confirmed: boolean;
  /**
   * The bounds the person was last asked to sign, with the hashes of those messages in order — only those are relayed.
   * A keeper at work keeps working by the bounds it has until the new approval lands.
   */
  pending: Readonly<{ choice: KeeperChoice; limits: RangeLimits; approval: RawPair | null; messages: readonly string[]; at: number }> | null;
  /** The hashes of the person's «take it back» messages, once built. */
  stopMessages?: readonly string[];
  /** When the keeper first saw this session open (`openSeenAtOf`). */
  openSeenAt: number | null;
  /** The moves of the last day and more, for the bounds' clock. */
  history: readonly ShiftRecord[];
  /** What a take-out paid to the wallet and may be laid back, per coin; null — nothing waits. */
  waiting: RawPair | null;
  hours: KeeperHours | null;
  shape: "narrow" | "wide" | null;
  wait: KeeperWait | null;
  lastClaimAt: number | null;
  events: readonly KeeperEvent[];
  createdAt: number;
  updatedAt: number;
}>;

export const KEEPER_EVENTS_KEPT = 40;
export const KEEPER_HISTORY_KEPT = 48;
const DAY_MS = 86_400_000;

export const keeperKey = (network: KeeperNetwork, owner: string, nftMint: string): string => `k:${network}:${owner}:${nftMint}`;
export const keeperPrefix = (network: KeeperNetwork, owner?: string): string => (owner ? `k:${network}:${owner}:` : `k:${network}:`);

export const isKeeperRow = (row: unknown): row is KeeperEntry => !!row && typeof row === "object" && (row as KeeperEntry).v === 1 && (row as KeeperEntry).kind === "stock-keeper";

export const keeperModeOfEntry = (entry: Pick<KeeperEntry, "limits">): KeeperMode => keeperModeOf(entry.limits);

/** A row with one more event, the oldest dropped past what is kept. */
export function withKeeperEvent(entry: KeeperEntry, event: KeeperEvent, patch: Partial<KeeperEntry> = {}): KeeperEntry {
  return { ...entry, ...patch, events: [...entry.events, event].slice(-KEEPER_EVENTS_KEPT), updatedAt: event.at };
}

/** One more move on the bounds' clock, the oldest dropped. */
export const withShift = (history: readonly ShiftRecord[], record: ShiftRecord): readonly ShiftRecord[] => [...history, record].slice(-KEEPER_HISTORY_KEPT);

/** Two raw pairs added; null and null is null. */
export function addRaw(a: RawPair | null, b: RawPair | null): RawPair | null {
  if (!a && !b) return null;
  const x = BigInt(a?.xRaw ?? "0") + BigInt(b?.xRaw ?? "0");
  const y = BigInt(b?.yRaw ?? "0") + BigInt(a?.yRaw ?? "0");
  return x === 0n && y === 0n ? null : { xRaw: x.toString(), yRaw: y.toString() };
}

/** The exchange as the keeper reads it for the screen. */
export function hoursWord(session: StockSession | null, now: number): KeeperHours {
  return hoursOf(session, now).state;
}

/* ------------------------------------------------------------------ the position's range */

export type SlotRead = Readonly<{ tickLowerId: number; tickUpperId: number; unlocked: string }>;

/** A tick as a price in whole coins: 1.0001^tick, moved by the coins' decimals. */
export const priceAtTick = (tickId: number, decimalsX: number, decimalsY: number): number => Math.pow(1.0001, tickId) * 10 ** (decimalsX - decimalsY);

/**
 * The range that holds the position's liquidity — from the lowest end to the highest of its slots that hold any it may
 * move — as prices; null where nothing of it is in the pool.
 */
export function rangeOfSlots(slots: readonly SlotRead[], decimals: Readonly<{ x: number; y: number }>): LiveRange | null {
  const live = slots.filter((slot) => slot.unlocked !== "0");
  if (live.length === 0) return null;
  const lower = Math.min(...live.map((slot) => slot.tickLowerId));
  const upper = Math.max(...live.map((slot) => slot.tickUpperId));
  return liveRangeOf(priceAtTick(lower, decimals.x, decimals.y), priceAtTick(upper, decimals.x, decimals.y));
}

/** The tick at or below a price in whole coins. */
export function tickOfPrice(price: number, decimalsX: number, decimalsY: number): number | null {
  if (!(price > 0) || !Number.isFinite(price)) return null;
  const tick = Math.floor(Math.log(price * 10 ** (decimalsY - decimalsX)) / Math.log(1.0001));
  return Number.isSafeInteger(tick) ? tick : null;
}

/* ------------------------------------------------------------------ the exchange's reference */

/**
 * The exchange's reference as the pool's own price — token Y per whole token X. One whole token stands for
 * `multiplier` shares (`lib/stocks/units.ts`), so it is worth the share's price that many times; the other coin is SOL,
 * at its own price in dollars. Null where any of it is not a number to trust.
 */
export function referenceInPool(input: Readonly<{ perShareUsd: number | null; multiplier: number | null; solUsd: number | null; stockIsX: boolean }>): number | null {
  const { perShareUsd, multiplier, solUsd } = input;
  if (perShareUsd === null || multiplier === null || solUsd === null) return null;
  if (!(perShareUsd > 0) || !(multiplier > 0) || !(solUsd > 0) || !Number.isFinite(perShareUsd * multiplier * solUsd)) return null;
  const tokenUsd = perShareUsd * multiplier;
  return input.stockIsX ? tokenUsd / solUsd : solUsd / tokenUsd;
}

/* ------------------------------------------------------------------ the screen's view */

export function keeperViewOf(entry: KeeperEntry, now: number): KeeperView {
  const day = entry.history.filter((record) => record.at <= now && now - record.at < DAY_MS).length;
  const last = entry.events.filter((event) => event.kind !== "refused").at(-1)?.at ?? null;
  return {
    key: entry.key,
    nftMint: entry.nftMint,
    pool: entry.pool,
    status: entry.status,
    stoppedBy: entry.stoppedBy,
    mode: keeperModeOfEntry(entry),
    choice: entry.choice,
    hours: entry.hours,
    shape: entry.shape,
    wait: entry.wait,
    waiting: entry.waiting !== null,
    movesToday: day,
    lastAt: last === null ? null : new Date(last).toISOString(),
  };
}
