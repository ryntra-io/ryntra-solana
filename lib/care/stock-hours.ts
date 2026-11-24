/**
 * The keeper of a stock's pool: narrow around the price while the exchange is open, wider while it is
 * closed, out of the way of a dividend. One pure choice — the state in, one action or nothing out.
 *
 * Everything it reads is what the engine already knows, by the Stock Pier's own rules: the session from the issuer's trading period — never a «Monday to Friday» rule, so a holiday is simply a
 * closed session — and the dividend guard from the chain's scheduled step of the token's multiplier. The price it
 * centres on is the exchange's reference where the engine has a current one, the pool's own otherwise.
 *
 * In order:
 * 1. **no session known** — nothing; nothing is guessed;
 * 2. **the dividend guard** — inside the window nothing new goes in; a person who chose «leave» (the Pier's default
 *    plan for a step) has the agent take the liquidity out to the wallet;
 * 3. **the open** — the first quarter of an hour after the open the range stays as the night left it: the opening
 *    jump settles first. Then narrow, around the exchange's price — but only once the pool's price sits in the inner
 *    half of that narrow range: until the pool has caught up with a jump, liquidity laid at its stale price is what
 *    an arbitrage takes, and liquidity laid at the exchange's would stand on one side of the pool's price and earn
 *    nothing;
 * 4. **closing and closed** — the range goes wide before the close (the Pier's «closing» hour) and stays wide through
 *    nights, weekends and holidays — around the exchange's price where the pool's sits inside it the same way, around
 *    the pool's own otherwise. A keeper that only takes out (`pull`, nothing put back) takes the narrow liquidity
 *    out to the wallet instead: it cannot lay a wider range with the person's money;
 * 5. **the price drifts** — the range is laid again around the price once the price is half the range's half-width
 *    from its centre; a range within a tenth of the width asked for and near the price is left as it is.
 *
 * Every move stays inside the person's bounds (`./range-limits.ts`): the narrow range is the narrowest allowed, the
 * wide one the widest (or twice the expected opening gap, when the engine knows it, within them); the time since the
 * last move and the day's count are checked here; what the built move costs and puts back is checked on the build,
 * before the signature (`shiftRefusal`).
 *
 * The person's stop and the fees are the care's own, before and after this (`lib/earn-pro/care.ts`): the stop first,
 * then this, then the fees.
 *
 * Pure: no I/O, no clock, no environment.
 */

import { dividendGuard, hoursOf, type StockSession, type StockStep } from "../../city/lib/earn/stock-pier-hours.ts";
import { keeperModeOf, rangeAround, shiftTimingRefusal, type LiveRange, type RangeLimits, type ShiftRecord } from "./range-limits.ts";

/** After the open, the range stays as the night left it this long: the opening jump settles first. */
export const OPEN_SETTLE_MS = 15 * 60_000;
/** The range is laid again once the price is this share of its half-width from its centre. */
export const RECENTER_SHARE = 0.5;
/** A range within this share of the half-width asked for is that width. */
export const WIDTH_TOLERANCE = 0.1;

export type StockKeeperState = Readonly<{
  /** The issuer's trading period as the Stock Pier reads it; null — no source said. */
  session: StockSession | null;
  /** When the keeper first saw this session open, ms (`openSeenAtOf`); null — not open. */
  openSeenAt: number | null;
  /** The token's scheduled step of its multiplier, when one is in sight. */
  step: StockStep | null;
  /** The pool's price now, token Y per whole token X. */
  poolPrice: number;
  /** The exchange's reference price in the same units, and whether it is current (exchange open, fresh); null — none. */
  reference: Readonly<{ price: number; current: boolean }> | null;
  /** The range that holds the position's liquidity; null — nothing of the position is in the pool. */
  range: LiveRange | null;
  /** Whether the person's wallet holds what the keeper took out before and may put back. */
  waitingInWallet: boolean;
  /** How far the price has jumped at past opens, bps (from the reference feed's history); null — not known. */
  expectedGapBps: number | null;
}>;

/** The person's plan for a dividend step — the Stock Pier's own: step out for its window, or stay. */
export type DividendPlan = "leave" | "stay";

export type StockShape = "narrow" | "wide";

export type StockWait =
  | "bad-price"
  | "session-unknown"
  | "dividend-hold"
  | "opening"
  | "price-apart"
  | "in-shape"
  | "nothing-in-pool"
  /** A keeper that only takes out cannot do what the hours ask: the person's tap puts the money back. */
  | "needs-owner"
  | "too-soon"
  | "too-many";

export type StockKeeperAction =
  | Readonly<{ kind: "shift"; shape: StockShape; centerPrice: number; halfWidthBps: number; lowerPrice: number; upperPrice: number; reason: "open" | "close" | "recenter" | "back" }>
  | Readonly<{ kind: "pull"; reason: "dividend" | "close" }>
  | Readonly<{ kind: "wait"; reason: StockWait }>;

const wait = (reason: StockWait): StockKeeperAction => ({ kind: "wait", reason });

/** How far apart two prices are, bps of the lower. */
export function apartBps(a: number, b: number): number {
  return Math.round((Math.max(a, b) / Math.min(a, b) - 1) * 10_000);
}

/** The night's half-width: twice the expected opening gap, within the person's bounds; the widest allowed when the gap is not known. */
export function nightHalfWidthBps(limits: Pick<RangeLimits, "narrowestBps" | "widestBps">, expectedGapBps: number | null): number {
  if (expectedGapBps === null || !Number.isFinite(expectedGapBps) || expectedGapBps <= 0) return limits.widestBps;
  return Math.min(limits.widestBps, Math.max(limits.narrowestBps, Math.round(2 * expectedGapBps)));
}

/** When the keeper saw this session open: kept while the exchange stays open, set the first time it is seen open, cleared when it closes. */
export function openSeenAtOf(previous: number | null, session: StockSession | null, now: number): number | null {
  const state = hoursOf(session, now).state;
  if (state === "open" || state === "closing") return previous ?? now;
  return null;
}

/** Whether a range is the one asked for: about that width, and the price near its centre. */
export function inShape(range: LiveRange, centerPrice: number, halfWidthBps: number): boolean {
  const width = Math.abs(range.halfWidthBps - halfWidthBps) <= WIDTH_TOLERANCE * halfWidthBps;
  return width && apartBps(centerPrice, range.centerPrice) <= RECENTER_SHARE * range.halfWidthBps;
}

/** The one action for now. */
export function stockKeeperAction(state: StockKeeperState, limits: RangeLimits, plan: DividendPlan, history: readonly ShiftRecord[], now: number): StockKeeperAction {
  if (!(state.poolPrice > 0) || !Number.isFinite(state.poolPrice)) return wait("bad-price");
  const hours = hoursOf(state.session, now);
  if (hours.state === "unknown") return wait("session-unknown");
  const mode = keeperModeOf(limits);

  const guard = dividendGuard(state.step, now);
  if (guard.kind === "hold") return state.range && plan === "leave" ? { kind: "pull", reason: "dividend" } : wait("dividend-hold");

  const open = hours.state === "open";
  if (open && (state.openSeenAt === null || now - state.openSeenAt < OPEN_SETTLE_MS)) return wait("opening");
  const shape: StockShape = open ? "narrow" : "wide";
  const halfWidthBps = shape === "narrow" ? limits.narrowestBps : nightHalfWidthBps(limits, state.expectedGapBps);
  const reference = state.reference && state.reference.current && state.reference.price > 0 && Number.isFinite(state.reference.price) ? state.reference.price : null;
  /* The exchange's price is the centre where the pool's own sits in the inner half of the range laid around it. */
  const holdsPool = reference !== null && apartBps(reference, state.poolPrice) <= RECENTER_SHARE * halfWidthBps;
  if (shape === "narrow" && reference !== null && !holdsPool) return wait("price-apart");
  const centerPrice = holdsPool ? reference! : state.poolPrice;

  if (!state.range) {
    if (!state.waitingInWallet) return wait("nothing-in-pool");
    if (mode === "pull") return wait("needs-owner");
  } else if (inShape(state.range, centerPrice, halfWidthBps)) {
    return wait("in-shape");
  } else if (mode === "pull") {
    /* A keeper that only takes out: before the close the narrow liquidity goes to the wallet; a range already as wide as the night's stays. */
    if (shape === "wide") return state.range.halfWidthBps >= halfWidthBps * (1 - WIDTH_TOLERANCE) ? wait("in-shape") : { kind: "pull", reason: "close" };
    return wait("needs-owner");
  }

  const timing = shiftTimingRefusal(limits, history, now);
  if (timing) return wait(timing);
  const sameShape = state.range !== null && Math.abs(state.range.halfWidthBps - halfWidthBps) <= WIDTH_TOLERANCE * halfWidthBps;
  const reason = state.range === null ? "back" : sameShape ? "recenter" : shape === "narrow" ? "open" : "close";
  return { kind: "shift", shape, centerPrice, halfWidthBps, ...rangeAround(centerPrice, halfWidthBps), reason };
}
