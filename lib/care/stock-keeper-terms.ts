/**
 * The choices a person makes once for the keeper of a stock pool, and the bounds they make
 * (`./range-limits.ts`). The screen offers these and nothing else; the server takes the same choices, builds the bounds
 * itself and holds every move to them — a request never carries bounds of its own.
 *
 * Three choices and two switches:
 * - **how wide** (`width`) — the narrowest range while the exchange is open and the widest while it is closed, half
 *   the range either way;
 * - **how often** (`pace`) — the least time between two moves and the most moves in a day;
 * - **the most a move may cost** (`cost`) — the network, the priority and the rent the agent puts up, per move; a day's
 *   bound is that times the day's moves;
 * - **put back** (`putBack`) — whether the agent lays the money back into the new range from the person's wallet (her
 *   spending approval on her own two accounts) or only takes it out to the wallet. On mainnet only the second is
 *   offered (`./stock-keeper-gate.ts`);
 * - **a dividend** (`plan`) — step out for its window (the Stock Pier's default) or stay.
 *
 * Pure and client-safe: no I/O, no clock, no environment.
 */

import { RANGE_MAX_HALF_WIDTH_BPS, keeperModeOf, type KeeperMode, type RangeLimits, type RawPair, type ShiftRefusal } from "./range-limits.ts";
import type { DividendPlan, StockWait } from "./stock-hours.ts";

/** Why the keeper waits: the hours' own reasons, a bound the person signed, or her approval or wallet that no longer covers a move. */
export type KeeperWait = StockWait | ShiftRefusal | "approval";

export const KEEPER_WIDTHS = Object.freeze({
  tight: Object.freeze({ narrowestBps: 50, widestBps: 300 }),
  usual: Object.freeze({ narrowestBps: 100, widestBps: 500 }),
  loose: Object.freeze({ narrowestBps: 200, widestBps: 1_000 }),
});
export type KeeperWidth = keyof typeof KEEPER_WIDTHS;

const MIN = 60_000;
export const KEEPER_PACES = Object.freeze({
  calm: Object.freeze({ minIntervalMs: 120 * MIN, maxShiftsPerDay: 4 }),
  usual: Object.freeze({ minIntervalMs: 60 * MIN, maxShiftsPerDay: 8 }),
  busy: Object.freeze({ minIntervalMs: 30 * MIN, maxShiftsPerDay: 16 }),
});
export type KeeperPace = keyof typeof KEEPER_PACES;

/** The most one move may cost the agent, lamports. */
export const KEEPER_COSTS = Object.freeze({ low: 10_000_000, usual: 20_000_000, high: 50_000_000 });
export type KeeperCost = keyof typeof KEEPER_COSTS;

export const DIVIDEND_PLANS = ["leave", "stay"] as const satisfies readonly DividendPlan[];

/** A move may lay back up to this share of the whole position in either coin: the price moves inside a move's band. */
export const PUT_BACK_ROOM = 1.1;
/** The moves of a day may lay back this many times what one move may: the open, the close and two recentres. */
export const PUT_BACKS_PER_DAY = 4;

export type KeeperChoice = Readonly<{ width: KeeperWidth; pace: KeeperPace; cost: KeeperCost; plan: DividendPlan; putBack: boolean }>;

export const DEFAULT_KEEPER_CHOICE: KeeperChoice = Object.freeze({ width: "usual", pace: "usual", cost: "usual", plan: "leave", putBack: false });

const own = (table: object, key: unknown): boolean => typeof key === "string" && Object.hasOwn(table, key);

/** A choice as the request carries it, or null where any part of it is not one the screen offers. */
export function keeperChoiceOf(value: unknown): KeeperChoice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!own(KEEPER_WIDTHS, raw.width) || !own(KEEPER_PACES, raw.pace) || !own(KEEPER_COSTS, raw.cost)) return null;
  if (!(DIVIDEND_PLANS as readonly unknown[]).includes(raw.plan) || typeof raw.putBack !== "boolean") return null;
  return { width: raw.width as KeeperWidth, pace: raw.pace as KeeperPace, cost: raw.cost as KeeperCost, plan: raw.plan as DividendPlan, putBack: raw.putBack };
}

const NOTHING: RawPair = Object.freeze({ xRaw: "0", yRaw: "0" });

/** The bounds a choice makes. `putBackPerShift` — what one move may lay back, per coin; ignored for a keeper that only takes out. */
export function keeperLimitsOf(choice: KeeperChoice, putBackPerShift: RawPair = NOTHING): RangeLimits {
  const width = KEEPER_WIDTHS[choice.width];
  const pace = KEEPER_PACES[choice.pace];
  const cost = KEEPER_COSTS[choice.cost];
  const shift = choice.putBack ? putBackPerShift : NOTHING;
  const times = BigInt(PUT_BACKS_PER_DAY);
  return {
    narrowestBps: width.narrowestBps,
    widestBps: Math.min(RANGE_MAX_HALF_WIDTH_BPS, width.widestBps),
    minIntervalMs: pace.minIntervalMs,
    maxShiftsPerDay: pace.maxShiftsPerDay,
    maxCostPerShiftLamports: cost,
    maxCostPerDayLamports: cost * pace.maxShiftsPerDay,
    maxPutBackPerShift: { xRaw: shift.xRaw, yRaw: shift.yRaw },
    maxPutBackPerDay: { xRaw: (BigInt(shift.xRaw) * times).toString(), yRaw: (BigInt(shift.yRaw) * times).toString() },
  };
}

/**
 * What one move may lay back, per coin: the whole position's worth in that coin with room for the price to move —
 * so a range can be laid in whatever proportion its place around the price asks.
 */
export function putBackOf(position: Readonly<{ xRaw: string; yRaw: string }>, pool: Readonly<{ price: number; decimalsX: number; decimalsY: number }>): RawPair {
  const x = Number(position.xRaw) / 10 ** pool.decimalsX;
  const y = Number(position.yRaw) / 10 ** pool.decimalsY;
  if (!(pool.price > 0) || !Number.isFinite(pool.price) || !Number.isFinite(x) || !Number.isFinite(y)) return NOTHING;
  const inX = (x + y / pool.price) * PUT_BACK_ROOM;
  const inY = (x * pool.price + y) * PUT_BACK_ROOM;
  const raw = (whole: number, decimals: number) => {
    const value = Math.ceil(whole * 10 ** decimals);
    return Number.isSafeInteger(value) && value > 0 ? value.toString() : "0";
  };
  return { xRaw: raw(inX, pool.decimalsX), yRaw: raw(inY, pool.decimalsY) };
}

/** The approval the person signs for a keeper that puts back: one day's bound, which the token program holds as a total. */
export const approvalOf = (limits: RangeLimits): RawPair | null => (keeperModeOf(limits) === "shift" ? { ...limits.maxPutBackPerDay } : null);

/* ------------------------------------------------------------------ what the screen reads back */

export type KeeperHours = "open" | "closing" | "closed" | "unknown";

/** One keeper as the screen reads it. Public data only. */
export type KeeperView = Readonly<{
  /** The keeper's row in the book: what «Stop» names. */
  key: string;
  nftMint: string;
  pool: string;
  status: "signing" | "working" | "stopped";
  stoppedBy: "owner" | "gone" | null;
  mode: KeeperMode;
  choice: KeeperChoice;
  /** The exchange as the keeper last read it; null — not read yet. */
  hours: KeeperHours | null;
  /** The shape the keeper last laid; null — none yet. */
  shape: "narrow" | "wide" | null;
  /** Why it waits now, when it does. */
  wait: KeeperWait | null;
  /** Money the keeper took out waits in the wallet for the person's tap (or for the next move, where it puts back). */
  waiting: boolean;
  movesToday: number;
  lastAt: string | null;
}>;

export type KeeperStatus = Readonly<{
  network: "devnet" | "mainnet";
  /** What a keeper may be given here: a keeper that only takes out, and one that puts back where the switch allows it. */
  modes: readonly KeeperMode[];
  /** Devnet stand pools a keeper may be given though no stock shelf names their coin. */
  standPools: readonly string[];
  keepers: readonly KeeperView[];
}>;
